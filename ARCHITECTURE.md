# Architecture

MandateGuard lets a person hand an AI agent real spending power on Razorpay
rails, bounded by a signed mandate, revocable at any moment, and audited to the
paisa.

This document explains how it is built and why it is built that way. Where a
decision had a real alternative, the alternative is named and the tradeoff
stated.

---

## 1. The one idea

**The LLM plans. The code decides.**

Shopping is judgment work. Interpreting "restock my pantry under ₹3,000",
composing a basket, substituting when something is out of stock — none of that
can be written as rules, and that is why there is a model in this system at all.

Authorization is the opposite. Whether a purchase is inside a mandate is a
comparison, and comparisons should be made by code that cannot be argued with.

So the system is split down that line. The agent proposes. A pure function
decides. The agent holds no Razorpay credentials and has no path to money that
does not pass through that function.

The practical consequence is worth stating plainly: a prompt injection can
convince the model of anything it likes, and it still cannot move a rupee.

---

## 2. System diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│  BROWSER — Next.js App Router                                         │
│  /console  /mandates/new  /catalog  /ledger  /trust                   │
└──────────────┬────────────────────────────────────▲───────────────────┘
               │ POST /api/agent/run                 │ SSE
               │ POST /api/mandates                  │ text · tool_call
               │ POST /api/mandates/:id/revoke       │ decision · purchase
┌──────────────▼────────────────────────────────────┴───────────────────┐
│  NEXT.JS SERVER                                                        │
│                                                                        │
│   ┌────────────────────┐   proposes    ┌────────────────────────────┐  │
│   │  BUYER AGENT       │──────────────▶│  POLICY ENGINE             │  │
│   │  claude-opus-5     │               │  pure TS · no LLM · no I/O │  │
│   │  hand-written loop │◀──────────────│  9 checks, never short-    │  │
│   │  3 tools only      │  ALLOW/BLOCK  │  circuits                  │  │
│   │  no credentials    │               └──────────┬─────────────────┘  │
│   └─────────┬──────────┘                          │ ALLOW only         │
│             │ search_catalog / get_item           ▼                    │
│             ▼                          ┌────────────────────────────┐  │
│   ┌────────────────────┐               │  RAZORPAY EXECUTOR         │  │
│   │  CATALOG (12 SKUs) │               │  the single choke point    │  │
│   │  untrusted content │               │  idempotent per decision   │  │
│   └────────────────────┘               └──────────┬─────────────────┘  │
│                                                   │                    │
│   ┌───────────────────────────────────────────────▼─────────────────┐  │
│   │  AUDIT LEDGER — append-only, SHA-256 hash-chained               │  │
│   │  every verdict, allowed and refused alike                       │  │
│   └───────────────────────────────┬─────────────────────────────────┘  │
│                                   │              ▲                     │
│                                   ▼              │ order.paid          │
│                        ┌────────────────┐  ┌─────┴──────────────────┐  │
│                        │ SQLite (Prisma)│  │ /api/webhooks/razorpay │  │
│                        └────────────────┘  │ real HMAC verification │  │
└────────────────────────────────────────────┴─────▲────────────────────┘
                                                   │
                                   ┌───────────────┴───────────────┐
                                   │  RAZORPAY — TEST MODE         │
                                   │  Orders · Payment Links       │
                                   └───────────────────────────────┘
```

---

## 3. The authorization path

Every purchase follows exactly this sequence. There is no other route to money.

1. The agent calls `request_purchase` with a merchant, item, category and amount.
2. The handler **re-reads the mandate from the database**. Status is never cached
   across turns, which is what makes revocation take effect on the agent's very
   next action rather than at the end of a run.
3. It gathers ledger state: spend so far, recent transaction times, and the
   idempotency keys already seen.
4. `evaluate()` runs nine checks and returns a verdict plus every failing reason
   code.
5. The decision is appended to the hash-chained ledger, whether it allowed or
   refused. Refusals are recorded as carefully as approvals.
6. Only on `ALLOW` does `executePayment()` create a Razorpay order.
7. A webhook later confirms capture and credits the settled-spend counter.

### The nine checks

In fixed order, because the order appears in the audit record:

| # | Check | Reason code on failure |
|---|---|---|
| 1 | Mandate signature valid | `SIGNATURE_INVALID` |
| 2 | Request not already seen | `DUPLICATE_REQUEST` |
| 3 | Status is ACTIVE | `MANDATE_REVOKED` / `MANDATE_NOT_ACTIVE` |
| 4 | Not expired | `MANDATE_EXPIRED` |
| 5 | Merchant on allowlist | `MERCHANT_NOT_ALLOWLISTED` |
| 6 | Category permitted | `CATEGORY_NOT_ALLOWED` |
| 7 | Within per-transaction cap | `PER_TXN_CAP_EXCEEDED` |
| 8 | Within remaining total cap | `TOTAL_CAP_EXCEEDED` |
| 9 | Within the hourly velocity limit | `VELOCITY_LIMIT_EXCEEDED` |

**Evaluation never short-circuits.** One attempt that breaks four rules reports
four rules broken. Short-circuiting would be faster and would tell you less.

---

## 4. Design decisions

Each of these had a plausible alternative. The alternative is named.

### The policy engine is a pure function, and it is not routable

`evaluate()` in `src/lib/policy/engine.ts` does no I/O, reads no clock, and makes
no model call. Everything time-dependent arrives as an argument.

It is deliberately not exposed as an HTTP endpoint of its own. The property that
matters is narrower and stronger than "no endpoint exists": there is no path to
money that skips the engine. Every caller goes through `authorizeAndExecute()` in
`src/lib/authorize.ts`, and that function always runs the engine. A future MCP
server would reach the same function rather than reimplementing it.

*Alternative considered:* an LLM-assisted policy layer for "edge cases". Rejected.
A prompt-based guard can be talked out of its rules, which is the entire
prompt-injection literature. A comparison between two integers cannot.

### Purity is what makes the metrics real

Because `evaluate()` is pure, the 68-case adversarial suite is deterministic and
byte-identical on any machine. Anyone can clone the repo and reproduce the
numbers. That is the difference between a metrics table and a claim.

Honest caveat: `latencyMs` is a wall-clock measurement and is the one field that
varies between identical calls. The decision itself does not.

### Money is counted at authorization, not at settlement

The cap is enforced against the sum of `ALLOW` decisions, not against
webhook-confirmed spend.

This matters. Webhooks lag, and sometimes never arrive. If the engine enforced
against settled spend, an agent could authorize ten purchases inside the lag
window while every individual check passed. The system reserves against the cap
the moment it authorizes.

Settled spend is still tracked separately, for display. Two numbers, two
meanings.

### Idempotency is keyed on the request, not the action

The key is `hash(runId + toolUseId + action)`.

The obvious alternative — `hash(mandateId + action)` — was what shipped first,
and it was wrong. It made a legitimate repeat purchase of the same item next week
look like a replay. A genuine retry re-sends the same run and tool-use id and is
caught. Buying atta again in a later run is a different request and is allowed.

The key is stored but **not unique** in the database, because the ledger has to be
able to record a refused replay. Double execution is prevented by the engine's
duplicate check and hard-stopped by `Transaction.decisionId` being unique.

### The ledger is hash-chained, and the explanation is excluded from the digest

Each row stores `hash = sha256(canonical({ prevHash, ...digest }))`.
`verifyChain()` recomputes the whole chain on request rather than trusting a
stored flag.

The LLM-written `explanation` field is deliberately **outside** the digest. It is
prose produced after the verdict and it is cosmetic. The chain protects the
decision, not the narration.

Editing any recorded verdict breaks the chain at that row and every row after it,
so a forger cannot repair it by editing one entry. `npm run smoke:phase1`
demonstrates this by rewriting a `BLOCK` to look like an `ALLOW` and showing
`verifyChain()` report the break.

### One choke point to money

`executePayment()` takes a persisted decision **id**, reloads it, and refuses
anything whose recorded verdict is not `ALLOW`.

It reloads rather than accepting a verdict as an argument because an argument can
be forged by any caller. A row can only have been written by the ledger, which is
only written from the engine's output.

### Untrusted content handling is defence-in-depth, not the defence

Catalog text is wrapped in explicit delimiters and the system prompt states that
catalog text is data, never instruction. Delimiters inside the content are
neutralised so a crafted description cannot close the fence early.

None of this is load-bearing. The architecture assumes this prompt will
eventually be talked around, and is built so that it does not matter when it is.

### Money is integer paise everywhere, rupees only at the input edge

Floats lose money, and Razorpay's own API takes paise. The only conversion is in
two form inputs, so a person types `800` rather than `80000`.

### One mandate is active at a time

Signing a new mandate supersedes any existing active one, and the supersede is
written to the ledger.

Before this, signing twice left the first mandate ACTIVE while the console showed
only the newest — invisible authority that was still spendable through the API.
Silently orphaned authority is exactly the failure this product exists to
prevent.

### The agent has its own guardrails, separate from the money

A twelve-turn cap and a ninety-second wall clock. A runaway loop is its own
failure mode, distinct from overspend, and a demo that hangs is a demo that
failed.

### The agent loop is hand-written

Roughly sixty lines, not LangGraph and not the SDK tool runner.

LangGraph is Python-first and would have meant a two-language stack. The SDK tool
runner would have worked, but every turn has to emit a ledger row and a UI event
regardless, and a loop that can be walked through line by line is easier to
defend than "the SDK handles it".

### The model is behind a seam

`ModelClient` has two implementations: the real Anthropic client, and a scripted
one that replays fixed turns.

One seam, three jobs. The loop could be built before an API key existed. Tests
get determinism the real API can never provide. And it is the on-camera fallback,
where the agent's choices are fixed but the policy engine still genuinely
evaluates and refuses.

What it cannot tell us is whether the real model behaves sensibly. That needs a
live key, and no mock substitutes for it.

---

## 5. Data model

SQLite via Prisma. All money is integer paise.

| Model | Role |
|---|---|
| `Mandate` | Signed rule set, status, caps, expiry |
| `Merchant`, `CatalogItem` | Seed fixtures, not a product |
| `AgentRun` | One invocation of the agent |
| `Decision` | **The audit ledger.** Append-only, hash-chained |
| `Transaction` | Razorpay order per allowed decision, unique per decision |
| `EvalRun` | Adversarial suite results |

`Decision` is never updated and never deleted. Latency is stored in
**microseconds**, because authorization is sub-millisecond and an integer of
milliseconds recorded zero for every row.

---

## 6. Failure handling

| Failure | Behaviour |
|---|---|
| Agent proposes an out-of-bounds purchase | Refused, reason codes returned, agent adapts |
| Mandate revoked mid-run | Next proposal refused immediately, nothing queued |
| Model API unavailable | Run halts, `AGENT_ERROR` written to the ledger, mandate intact and unspent |
| Razorpay call fails after authorization | Decision already recorded, retry is idempotent |
| Webhook replayed | Second delivery ignored, spend not double-counted |
| Webhook signature invalid | 400, not retried |
| Ledger row tampered with | `verifyChain()` reports the break and its sequence number |

---

## 7. What is real and what is simulated

**Real.** The policy engine. Mandate signing and verification. The hash-chained
ledger. The agent loop. Razorpay Orders, with real test-mode order ids visible in
the dashboard. Webhook HMAC verification. Revocation. Every number on the Trust
Report.

**Simulated.** Bulk payment capture. Razorpay test mode cannot complete a payment
server-side without a checkout surface, and full server-to-server creation needs
an approval this project does not have. So the *event* is synthetic while the
*verification* is not: the payload is Razorpay-shaped, signed with the real
webhook secret, and verified by the same code path a genuine delivery would take.
One payment in the demo is completed for real through a Payment Link.

**Fixtures.** The 12-SKU catalog and its four merchants.

---

## 8. Measured outcomes

`npm run eval` — 68 adversarial cases through the real policy engine.

| Metric | Result |
|---|---|
| Cases | 68 |
| Refused correctly | 58 / 58 |
| Allowed correctly | 10 / 10 |
| **Unauthorized spend** | **₹0** |
| Authorization p50 | ~30µs |
| Ledger chain | verified |

Reported per category in `evals/README.md`, because an aggregate hides which rule
is weak. The suite exits non-zero if any case fails or a single paisa escapes.

A note on the latency figures, since they are easy to overstate. p50 is stable at
roughly 30 microseconds across runs. p99 is not: it ranges from about 180µs to
1.3ms and is dominated by the first call in a process, where the JIT has not yet
warmed up. Quoting a precise p99 would suggest a precision this measurement does
not have. The number that carries the argument is p50, and the reason it is small
is that `evaluate()` does no I/O at all.

---

## 9. What would change at scale

Stated plainly, because the prototype makes choices a production system would not.

- **Ledger appends are serialised behind an in-process mutex.** That is correct
  for a single process and wrong for several. It becomes a database sequence or
  an advisory lock.
- **SQLite** becomes Postgres. Nothing in the schema depends on SQLite beyond
  storing enums and arrays as strings.
- **HMAC signing** becomes per-user Ed25519 keypairs, which enables delegation
  chains and third-party verification.
- **No authentication.** Single-tenant prototype with a hardcoded demo user.
- **The policy engine does not change.** It is already pure, already stateless,
  and scales horizontally without modification. That is the point of having built
  it that way.

---

## 10. Known limitations

- The adversarial cases are self-authored. They are published, reproducible, and
  reported per category, but they are not an independent benchmark.
- Latency is measured on a pure in-process function and excludes network,
  database and Razorpay time.
- The suite tests the policy engine. Whether the model behaves sensibly is a
  separate question.
- The agent has only been exercised against the scripted model so far.
- UPI Reserve Pay and UPI Circle are conceptual alignment, not integrations. The
  mandate vocabulary mirrors their semantics. No NPCI API is called.
