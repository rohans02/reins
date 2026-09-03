# MandateGuard

**A Lakshman Rekha for AI agents.** The authorization layer that lets you hand an AI agent
real spending power on Razorpay rails: bounded by a signed mandate, enforced in code rather
than in a prompt, revocable in one click, and audited to the paisa.

> Razorpay AI Buildathon — Track 1 (AI Growth & Agentic Commerce)

---

## The idea in one line

**The LLM plans. The code decides.**

The buyer agent shops on its own, but it holds no Razorpay credentials and has no code path
to money. Every purchase is a *proposal* to a deterministic policy engine, a pure function
with no prompt to inject, which returns ALLOW or BLOCK. Only ALLOW reaches Razorpay.

A prompt injection can convince the model of anything it likes. It still cannot move a rupee.

---

## What to look at first

If you have five minutes and want to judge whether this is real:

1. **`src/lib/policy/engine.ts`** — the whole product. A pure function, no I/O, no model
   call, nine checks, and it never short-circuits so one attempt that breaks four rules
   reports four rules broken.
2. **`npm run smoke:phase1`** — signs a mandate, evaluates three purchases, writes them to
   the hash-chained ledger, then rewrites a recorded BLOCK to look like an ALLOW and shows
   the chain detect it.
3. **`npm run eval`** — 68 adversarial cases through that same engine. Exits non-zero if a
   single paisa escapes.
4. **`/catalog` in the running app** — the prompt-injection payload sitting in a product
   description, before the agent ever reads it.
5. **[ARCHITECTURE.md](ARCHITECTURE.md)** — every design decision and the alternative it was
   chosen over.

---

## Run it

You need Razorpay **test-mode** keys and a signing secret. You do **not** need an Anthropic
API key: with none set, the agent runs from a scripted sequence, and the policy engine, the
ledger and the Razorpay orders are all still real.

```bash
cp .env.example .env
#   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET   from Dashboard > Settings > API Keys
#   RAZORPAY_WEBHOOK_SECRET                 any random string, you choose it
#   MANDATE_SIGNING_KEY                     openssl rand -hex 32
#   ANTHROPIC_API_KEY                       optional

npm install
npm run db:reset
npm run dev
```

Then open <http://localhost:3000>, create a mandate, and run the agent.

| Command | What it does |
|---|---|
| `npm test` | Policy engine and ledger unit tests |
| `npm run eval` | Adversarial suite, prints the metrics table |
| `npm run smoke:phase1` | sign → evaluate → append → verify → tamper → detected |
| `npm run smoke:phase2` | scripted agent → policy gate → real Razorpay orders → webhook → revoke |
| `npm run smoke:razorpay` | Confirms the Orders API works with your test keys |
| `npm run db:reset` | Wipe and reseed. Stop `npm run dev` first, it holds the database file |

---

## Measured outcomes

`npm run eval` — 68 adversarial cases through the real policy engine:

| Metric | Result |
|---|---|
| Refused correctly | 58 / 58 |
| Allowed correctly | 10 / 10 |
| **Unauthorized spend** | **₹0** |
| Authorization p50 | ~30µs |
| Ledger chain | verified |

Reported per category in [`evals/README.md`](evals/README.md), because an aggregate hides
which rule is weak. Ten cases are legitimate purchases that **must** be allowed, because a
suite of only refusals proves nothing except that the engine can say no.

Because `evaluate()` is a pure function, these numbers are deterministic. Clone the repo and
you get the same ones.

---

## Architecture

Full write-up, including every design decision and the alternative it was chosen over:
**[ARCHITECTURE.md](ARCHITECTURE.md)**.

```
Browser (Next.js App Router)
   |  POST /api/agent/run            ^  SSE: text, tool calls, verdicts
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

---

## Why AI, and where it is deliberately absent

AI is used in exactly three places, and kept out of a fourth on purpose:

| Where | Role | Load-bearing? |
|---|---|---|
| Buyer agent | Interprets an underspecified goal, composes a basket under budget, re-plans when refused | **Yes.** This cannot be rules |
| Mandate drafting | Free-text intent into a typed policy object | Yes, but it only **proposes**. A human approves and the server signs |
| Incident explainer | Turns reason codes into one human sentence | Cosmetic by design. Runs **after** the verdict |
| **Policy engine** | — | **Deliberately no AI.** It has to be deterministic, unfakeable, free, and provable |

---

## What works today

- Signed mandates, with supersede so only one can be active at a time
- The nine-check policy engine, with 29 unit tests
- Append-only SHA-256 hash-chained audit ledger with live verification
- A buyer agent with three tools and no credentials
- Real Razorpay test-mode orders, with ids that appear in the dashboard
- Webhook HMAC verification
- Revocation that takes effect on the agent's very next action, including mid-run
- Five screens: Mission Control, Mandate Studio, Catalog, Audit Ledger, Trust Report
- The 68-case adversarial suite

Not yet done: the LLM block-explainer is stubbed, and the agent has not been run against a
live model.

---

## Limitations

- **Payment capture is partly simulated.** Razorpay test mode cannot complete a payment
  server-side without a checkout surface, and full server-to-server creation needs an
  approval this project does not have. **Orders are real**, with real `order_id`s visible in
  the Razorpay dashboard, and one payment in the demo is completed for real through a
  Payment Link. Bulk capture is emitted by `src/lib/razorpay/simulator.ts`, which posts a
  Razorpay-shaped webhook signed with the **real** webhook secret into the **real** HMAC
  verification path. The event is synthetic. The verification is not.
- **The catalog is a fixture.** 12 SKUs across 4 merchants in `prisma/seed.ts`. Catalog
  ingestion is out of scope.
- **No authentication.** Single-tenant prototype with a hardcoded demo user.
- **The adversarial cases are self-authored.** They are published in
  `src/lib/eval/cases.ts`, reproducible with one command, reported per category rather than
  as one number, and include legitimate purchases as well as refusals. They are still not an
  independent benchmark.
- **Latency is measured on a pure in-process function.** It excludes network, database and
  Razorpay time, and is not an end-to-end figure.
- **The agent has only run against a scripted model so far.** `scriptedModel()` makes the
  loop deterministic and testable without an API key, and doubles as the `DEMO_MODE=scripted`
  fallback. What it cannot tell us is whether the real model re-plans sensibly after a
  refusal, or whether it takes the prompt-injection bait. That needs a live key.
- **Ledger appends are serialised by an in-process mutex.** Correct for one process, wrong
  for several. At scale it becomes a database sequence or an advisory lock.
- **UPI Reserve Pay and UPI Circle are conceptual alignment, not integrations.** The mandate
  vocabulary mirrors their semantics. No NPCI API is called.

---

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Prisma 7 + SQLite ·
`@anthropic-ai/sdk` (`claude-opus-5`) · `razorpay` Node SDK · Vitest
