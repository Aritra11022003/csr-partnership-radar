/**
 * Tiny key-value store abstraction.
 *  - Neon Postgres (serverless HTTP driver) when DATABASE_URL is set — production. Everything lives in its own
 *    `csr_radar` schema, so it can share a database with other apps without touching their tables.
 *  - Otherwise a JSON file in .data/ (local dev) or /tmp (serverless without a DB: ephemeral, warns).
 */
import fs from "node:fs";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export interface Store {
  kind: "neon" | "file" | "memory";
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /** Set only if absent. Returns true if the key was set. */
  setNX(key: string, value: unknown, ttlSeconds?: number): Promise<boolean>;
  del(key: string): Promise<void>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  /** Push to the head of a list, trimming to maxLen. */
  lpush(key: string, value: unknown, maxLen?: number): Promise<void>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  /** Pipeline of SETs (used for seen-URL hashes). */
  msetWithTtl(entries: [string, unknown][], ttlSeconds: number): Promise<void>;
}

/* ------------------------------- Neon ------------------------------- */
const SCHEMA_SQL = [
  `create schema if not exists csr_radar`,
  `create table if not exists csr_radar.kv (key text primary key, value jsonb not null, expires_at timestamptz, updated_at timestamptz not null default now())`,
  `create table if not exists csr_radar.list (id bigserial primary key, key text not null, item jsonb not null, created_at timestamptz not null default now())`,
  `create index if not exists list_key_id on csr_radar.list (key, id desc)`,
];

class NeonStore implements Store {
  kind = "neon" as const;
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;
  constructor(url: string) {
    this.sql = neon(url);
  }
  private init() {
    this.ready ??= (async () => {
      for (const q of SCHEMA_SQL) await this.sql.query(q);
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }
  private exp(ttl?: number) {
    return ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null;
  }
  async get<T>(key: string) {
    await this.init();
    const r = await this.sql.query(`select value from csr_radar.kv where key = $1 and (expires_at is null or expires_at > now())`, [key]);
    return (r[0]?.value as T) ?? null;
  }
  async set(key: string, value: unknown, ttl?: number) {
    await this.init();
    await this.sql.query(
      `insert into csr_radar.kv (key, value, expires_at) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = now()`,
      [key, JSON.stringify(value), this.exp(ttl)],
    );
  }
  /** Atomic: inserts, or takes over an expired key; returns false if a live key already exists. */
  async setNX(key: string, value: unknown, ttl?: number) {
    await this.init();
    const r = await this.sql.query(
      `insert into csr_radar.kv (key, value, expires_at) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = now()
       where csr_radar.kv.expires_at is not null and csr_radar.kv.expires_at <= now()
       returning key`,
      [key, JSON.stringify(value), this.exp(ttl)],
    );
    return r.length > 0;
  }
  async del(key: string) {
    await this.init();
    await this.sql.query(`delete from csr_radar.kv where key = $1`, [key]);
  }
  async mget<T>(keys: string[]) {
    if (!keys.length) return [];
    await this.init();
    const r = await this.sql.query(
      `select key, value from csr_radar.kv where key = any($1::text[]) and (expires_at is null or expires_at > now())`,
      [keys],
    );
    const m = new Map(r.map((x) => [x.key as string, x.value as T]));
    return keys.map((k) => m.get(k) ?? null);
  }
  async lpush(key: string, value: unknown, maxLen = 500) {
    await this.init();
    await this.sql.query(`insert into csr_radar.list (key, item) values ($1, $2::jsonb)`, [key, JSON.stringify(value)]);
    await this.sql.query(
      `delete from csr_radar.list where key = $1 and id not in (select id from csr_radar.list where key = $1 order by id desc limit $2)`,
      [key, maxLen],
    );
  }
  async lrange<T>(key: string, start: number, stop: number) {
    await this.init();
    const limit = stop === -1 ? 100000 : stop - start + 1;
    const r = await this.sql.query(`select item from csr_radar.list where key = $1 order by id desc offset $2 limit $3`, [key, start, limit]);
    return r.map((x) => x.item as T);
  }
  async msetWithTtl(entries: [string, unknown][], ttl: number) {
    if (!entries.length) return;
    await this.init();
    await this.sql.query(
      `insert into csr_radar.kv (key, value, expires_at)
       select k, v::jsonb, $3::timestamptz from unnest($1::text[], $2::text[]) as t(k, v)
       on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = now()`,
      [entries.map((e) => e[0]), entries.map((e) => JSON.stringify(e[1])), this.exp(ttl)],
    );
  }
}

/* --------------------------- File / memory -------------------------- */
interface Entry {
  v: unknown;
  exp?: number;
}

class FileStore implements Store {
  kind: "file" | "memory";
  private data: Record<string, Entry> = {};
  private loaded = false;
  constructor(private file: string | null) {
    this.kind = file ? "file" : "memory";
  }
  private load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.data = {};
    }
  }
  private save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch (e) {
      console.warn("[store] could not persist file store:", (e as Error).message);
    }
  }
  private live(key: string): Entry | undefined {
    this.load();
    const e = this.data[key];
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) {
      delete this.data[key];
      return undefined;
    }
    return e;
  }
  async get<T>(key: string) {
    return (this.live(key)?.v as T) ?? null;
  }
  async set(key: string, value: unknown, ttl?: number) {
    this.load();
    this.data[key] = { v: structuredClone(value), exp: ttl ? Date.now() + ttl * 1000 : undefined };
    this.save();
  }
  async setNX(key: string, value: unknown, ttl?: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }
  async del(key: string) {
    this.load();
    delete this.data[key];
    this.save();
  }
  async mget<T>(keys: string[]) {
    return keys.map((k) => (this.live(k)?.v as T) ?? null);
  }
  async lpush(key: string, value: unknown, maxLen = 500) {
    const list = ((this.live(key)?.v as unknown[]) ?? []).slice();
    list.unshift(value);
    await this.set(key, list.slice(0, maxLen));
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const list = (this.live(key)?.v as T[]) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async msetWithTtl(entries: [string, unknown][], ttl: number) {
    this.load();
    const exp = Date.now() + ttl * 1000;
    for (const [k, v] of entries) this.data[k] = { v, exp };
    this.save();
  }
}

let _store: Store | null = null;

export function getStore(): Store {
  if (_store) return _store;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    _store = new NeonStore(url);
  } else if (process.env.VERCEL) {
    console.warn("[store] No DATABASE_URL configured on Vercel: using ephemeral /tmp store.");
    _store = new FileStore("/tmp/csr-radar-store.json");
  } else {
    _store = new FileStore(path.join(process.cwd(), ".data", "store.json"));
  }
  return _store;
}

/** For tests. */
export function setStore(s: Store | null) {
  _store = s;
}
export function memoryStore(): Store {
  return new FileStore(null);
}

export const KEYS = {
  config: "config:v1",
  digest: (id: string) => `digest:${id}`,
  digestIndex: "digest:index",
  latest: "digest:latest",
  seen: (hash: string) => `seen:${hash}`,
  runLock: (week: string) => `runlock:${week}`,
  emailed: (week: string) => `emailed:${week}`,
  feedback: "feedback:log",
  feedbackScore: "feedback:company-scores",
  runLog: "runlog",
};
