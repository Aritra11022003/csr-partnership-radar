/**
 * Tiny key-value store abstraction.
 *  - Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL / KV_REST_API_URL is set (production).
 *  - Otherwise a JSON file in .data/ (local dev) or /tmp (serverless without Redis: ephemeral, warns).
 * Kept dependency-free on purpose: Upstash REST is just HTTPS + a bearer token.
 */
import fs from "node:fs";
import path from "node:path";

export interface Store {
  kind: "upstash" | "file" | "memory";
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

/* ----------------------------- Upstash ----------------------------- */
class UpstashStore implements Store {
  kind = "upstash" as const;
  constructor(private url: string, private token: string) {}

  private async cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(`Upstash ${args[0]} failed: ${json.error ?? res.status}`);
    return json.result;
  }

  private async pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    if (cmds.length === 0) return [];
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash pipeline failed: ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: string }[];
    return json.map((r) => r.result);
  }

  async get<T>(key: string) {
    const r = (await this.cmd(["GET", key])) as string | null;
    return r == null ? null : (JSON.parse(r) as T);
  }
  async set(key: string, value: unknown, ttl?: number) {
    const args: (string | number)[] = ["SET", key, JSON.stringify(value)];
    if (ttl) args.push("EX", ttl);
    await this.cmd(args);
  }
  async setNX(key: string, value: unknown, ttl?: number) {
    const args: (string | number)[] = ["SET", key, JSON.stringify(value), "NX"];
    if (ttl) args.push("EX", ttl);
    return (await this.cmd(args)) === "OK";
  }
  async del(key: string) {
    await this.cmd(["DEL", key]);
  }
  async mget<T>(keys: string[]) {
    if (keys.length === 0) return [];
    const out: (T | null)[] = [];
    for (let i = 0; i < keys.length; i += 500) {
      const r = (await this.cmd(["MGET", ...keys.slice(i, i + 500)])) as (string | null)[];
      out.push(...r.map((v) => (v == null ? null : (JSON.parse(v) as T))));
    }
    return out;
  }
  async lpush(key: string, value: unknown, maxLen = 500) {
    await this.pipeline([
      ["LPUSH", key, JSON.stringify(value)],
      ["LTRIM", key, 0, maxLen - 1],
    ]);
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const r = (await this.cmd(["LRANGE", key, start, stop])) as string[];
    return r.map((v) => JSON.parse(v) as T);
  }
  async msetWithTtl(entries: [string, unknown][], ttl: number) {
    for (let i = 0; i < entries.length; i += 200) {
      await this.pipeline(entries.slice(i, i + 200).map(([k, v]) => ["SET", k, JSON.stringify(v), "EX", ttl]));
    }
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
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    _store = new UpstashStore(url, token);
  } else if (process.env.VERCEL) {
    console.warn("[store] No Upstash Redis configured on Vercel: using ephemeral /tmp store.");
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
