# MandateGuard

**A Lakshman Rekha for AI agents** — the authorization layer that lets you hand an AI agent
real spending power on Razorpay rails: bounded by a signed mandate, enforced in code rather
than in a prompt, revocable in one click, and audited to the paisa.

> Razorpay AI Buildathon — Track 1 (AI Growth & Agentic Commerce)

---

## The idea in one line

**The LLM plans. The code decides.**

The buyer agent shops autonomously, but it holds no Razorpay credentials and has no code
path to money. Every purchase is a *proposal* to a deterministic policy engine — a pure
function with no prompt to inject — which returns ALLOW / BLOCK / ESCALATE. Only ALLOW
reaches Razorpay.

## Status

🚧 **Phases 1–4 built.** The policy engine, mandate signing and the hash-chained ledger
work end to end (`npm run smoke:phase1`). Phases 2–5 are stubbed; every stub throws with
the phase it belongs to.

| Phase | Scope | State |
|---|---|---|
| 1 | Policy engine · mandate signing · hash-chained ledger · tests · seed | ✅ |
| 2 | Agent loop · Razorpay Orders · webhook HMAC · payment simulator | ✅ built, pending live-model validation |
| 3 | Agent Console · Mandate Studio · Ledger UI · SSE streaming | ✅ (explainer deferred) |
| 4 | Adversarial suite · Trust Report | ✅ |
| 5 | README · architecture diagram · 5-min video | 🔨 diagram done, video outstanding |

## Run it

```bash
cp .env.example .env     # then fill in the keys
npm install
npm run db:reset         # push schema + seed catalog
npm run dev
```

Other commands:

```bash
npm test                 # policy engine unit tests
npm run eval             # adversarial suite -> metrics table
npm run smoke:phase1     # sign -> evaluate -> append -> verify -> tamper detection (needs .env)
npm run smoke:phase2     # scripted agent -> policy gate -> real Razorpay orders -> webhooks -> revoke
npm run smoke:razorpay   # proves the Orders API works with your test keys
npm run db:reset         # wipe + reseed (use this between demo takes)
```

## Measured outcomes

`npm run eval` — 68 adversarial cases through the real policy engine:

| Metric | Result |
|---|---|
| Refused correctly | 58 / 58 |
| Allowed correctly | 10 / 10 |
| **Unauthorized spend** | **₹0** |
| Authorization p50 | ~30µs |
| Ledger chain | verified |

Reported per category in `evals/README.md`, because an aggregate hides which rule
is weak. The suite exits non-zero if any case fails or a single paisa escapes.

## Architecture

Full write-up, including every design decision and the alternative it was chosen
over: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

```
Browser (Next.js App Router)
   |  POST /api/agent/run            ^  SSE: tokens, tool calls, verdicts
   v                                 |
Next.js server
   BUYER AGENT (claude-opus-5, 3 tools, no credentials)
        | proposes
        v
   POLICY ENGINE  -- pure TS, no LLM, no I/O, not routable
        | ALLOW only
        v
   RAZORPAY EXECUTOR (single choke point, idempotent)
        |
   AUDIT LEDGER (append-only, SHA-256 hash-chained)
        |
   SQLite (Prisma 7)          Razorpay test mode (Orders, Payment Links, webhooks)
```

## Why AI, and where it is deliberately absent

AI is used in exactly three places, and excluded from a fourth on purpose:

| Where | Role | Load-bearing? |
|---|---|---|
| Buyer agent | Interprets an underspecified goal, composes a basket under budget, re-plans when blocked | **Yes** — this cannot be rules |
| Mandate drafting | Free-text intent → typed policy object | Yes, but it only **proposes**; a human approves and the server signs |
| Incident explainer | Turns reason codes into one human sentence | Cosmetic by design — runs **after** the verdict |
| **Policy engine** | — | **Deliberately no AI.** Must be deterministic, unfakeable, free, and provable. |

## Limitations (honest)

*Keep this section. Fill it in as things land. Razorpay's rubric explicitly penalises
cherry-picking; stated limitations score.*

- **Payment authorization is partly simulated.** Razorpay test mode cannot complete a
  payment server-side without a checkout surface, and full S2S requires an approval we do
  not have. **Orders are real** (real API calls, real `order_id`s visible in the Razorpay
  dashboard) and **one payment in the demo is real** via a Payment Link + test card. Bulk
  payment authorization is emitted by `src/lib/razorpay/simulator.ts`, which posts a
  genuine Razorpay-shaped webhook signed with the **real** webhook secret into the **real**
  HMAC verification path.
- **The catalog is a fixture** — 12 SKUs across 4 merchants in `prisma/seed.ts`. Catalog
  ingestion is out of scope.
- **No authentication.** Single-tenant prototype with a hardcoded demo user.
- **Adversarial cases are self-authored.** Mitigated by publishing `evals/cases.json`, by
  reporting per-category rather than aggregate results, and by including legitimately-allowed
  cases so the suite is not all-blocks.
- **The agent loop has only been exercised with a scripted model so far.** `scriptedModel()`
  makes the loop deterministic and testable without an API key, and doubles as the
  `DEMO_MODE=scripted` fallback. What it cannot tell us is whether the real model re-plans
  sensibly after a BLOCK or takes the prompt-injection bait — that needs a live key and
  prompt iteration.
- **UPI Reserve Pay / UPI Circle are conceptual alignment, not integrations.** The mandate
  rule vocabulary mirrors their semantics; no NPCI API is called.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Prisma 7 + SQLite ·
`@anthropic-ai/sdk` (`claude-opus-5`) · `razorpay` Node SDK · Vitest
