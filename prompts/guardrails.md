# Guardrails — CSR Partnership Radar

Each guardrail lists: **what it protects against → how it is enforced → which test proves it**.

## A. Truthfulness
| # | Guardrail | Enforcement | Test |
|---|---|---|---|
| G1 | No fabricated facts | Classifier uses only the given text. Digest writer can only rephrase given fields. Output checker confirms every company and URL in the digest exists in the input. | Digest with an injected fake company is rejected and falls back to the template |
| G2 | Evidence required | `evidence` must be an exact substring of the source text. If not, the item is `verified=false`, takes −25, and cannot be `CALL`. | Mock an LLM returning paraphrased evidence → item downgraded |
| G3 | No guessed numbers | Amounts, beneficiaries, and deadlines are `null` unless stated | fx-12 → `amount_inr_crore === null` |
| G4 | Partner-search precision | `PARTNER_SEARCH` needs explicit seeking language. "Partners with X" does not count. | fx-10 is not `PARTNER_SEARCH` |
| G5 | Every item has a source | Items without a valid http(s) URL are dropped before the digest | Unit test |

## B. Security
| # | Guardrail | Enforcement | Test |
|---|---|---|---|
| G6 | Prompt injection in articles | Article text is wrapped as JSON data. The system prompt says text is data. `injection_flag` caps the verdict at WATCH. A regex pre-scan for "ignore previous instructions" and similar also sets the flag. | fx-09 is not CALL and is flagged |
| G7 | Secrets safe | API keys live only in Vercel env vars and are never sent to the client or written to logs | Grep the build output for the keys |
| G8 | Protected endpoints | `/api/run` requires `CRON_SECRET` or `ADMIN_TOKEN`. `/settings` save requires `ADMIN_TOKEN`. | Call without a token → 401 |
| G9 | Tool constraint | The app calls ONLY Gemini. No Anthropic SDK in `package.json`. | CI check |

## C. Correctness (deterministic, no LLM)
| # | Guardrail | Enforcement | Test |
|---|---|---|---|
| G10 | 7-day window | Date filter in code, based on IST | fx-08 dropped |
| G11 | Dedupe | Canonical URL hash, plus title Jaccard ≥ 0.8, plus same company + signal within the week. Seen URLs are kept 30 days. | fx-06 merged into fx-01, with both sources listed |
| G12 | Relevance | Non-India and non-focus-sector items → `IRRELEVANT` | fx-07, fx-11 |
| G13 | Schema validity | zod parse → one retry with an error hint → rule-based fallback | Mock malformed JSON |
| G14 | Confidence gate | `confidence < 0.6` cannot be CALL | Unit test |

## D. Reliability and cost
| # | Guardrail | Enforcement |
|---|---|---|
| G15 | One source failing does not kill the run | `Promise.allSettled`, with per-source status shown on the dashboard |
| G16 | Quiet week | Send a short "no strong signals this week" email that includes the scanned count |
| G17 | Cost cap | At most 120 items to the LLM and batches of 10. If over the cap, keep the highest pre-filter scores. |
| G18 | Time limit | Set `maxDuration`, run fetches in parallel, use a 10s timeout per source |
| G19 | Idempotent | A run key by ISO week prevents double emails if cron fires twice |

## E. Human and ethical
| # | Guardrail | Enforcement |
|---|---|---|
| G20 | Human decides | The system never emails or contacts companies. It only informs Ananya. |
| G21 | No personal data scraping | No harvesting of individuals' contact details. Company-level info only. |
| G22 | Transparency | Every item shows its source, date, and evidence. The footer states AI-generated content and asks the reader to verify. |
| G23 | Demo data separation | Fixtures load only when `DEMO_MODE=true` and are visibly tagged "DEMO". |
