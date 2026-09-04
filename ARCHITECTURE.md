# Architecture

Reins lets a person hand an AI agent real spending power on Razorpay
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
│   │  gemini / claude   │               │  pure TS · no LLM · no I/O │  │
│   │  hand-written loop │◀──────────────│  9 checks, never short-    │  │
│   │  4 tools only      │  ALLOW/BLOCK  │  circuits                  │  │
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
3. It **resolves the item from the catalog**; the agent's claimed merchant,
   category and price are recorded but never judged. An item id that does not
   exist, or is out of stock, is refused with `ITEM_UNKNOWN` without the engine
   being consulted at all — there is nothing to judge but the agent's own
   description of it.
4. It gathers ledger state: spend so far, recent transaction times, and the
   idempotency keys already seen.
5. `evaluate()` runs nine checks against the RESOLVED action and returns a
   verdict plus every failing reason code.
6. The decision is appended to the hash-chained ledger, whether it allowed or
   refused. Refusals are recorded as carefully as approvals, and a claim that
   disagreed with the catalog is stored alongside as evidence.
7. Only on `ALLOW` does `executePayment()` create a Razorpay order, reading the
   resolved amount and never the claimed one.
8. A webhook later confirms capture and credits the settled-spend counter.

Step 3 is what makes the allowlists real rather than advisory. Without it the
engine judges the agent's own label: the ₹4,999 Luxe watch, submitted as a one
rupee BigBasket grocery, passed every check. The engine was never wrong; it was
being handed the attacker's description of the thing instead of the thing.

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

### Mandates run concurrently, and every one of them is visible

A person can hold several live mandates at once: groceries at one set of
merchants, pharmacy at another, each on its own budget. The engine was always
built this way, because caps, velocity and spend are all keyed by mandate id.
Only the UI ever assumed there was one.

An earlier build made signing supersede every other active mandate. The reason
was real. The console showed only the newest, so an older ACTIVE mandate stayed
live and spendable through the API with nothing on screen saying so, and
silently orphaned authority is exactly the failure this product exists to
prevent.

But that answered a display problem by destroying authority the person never
asked to give up. The replacement is stricter. `/mandates` lists every mandate
that exists, states the combined exposure across all of them as a single number,
and puts revoke one click away. The sidebar reports the same total rather than
one mandate's. Nothing is hidden, so nothing has to be silently withdrawn.

The isolation this depends on is proved by `npm run smoke:mandates`, which shows
that spending under one mandate leaves another's cap untouched, that a purchase
allowed under one is refused under the other on its own rules, and that revoking
one leaves the other spending.

The audit ledger stays a SINGLE hash chain across all mandates. A per-mandate
chain could omit a decision and still verify, which would defeat the point of
having one, so mandate is a filter over one sequence and never a sequence of its
own.

### Authentication is optional. Ownership never is

Sign-in is GitHub or Google OAuth through Auth.js, and it activates only when a
provider's credentials are present. With none set the app runs on two demo
identities and says so on screen.

That is the same shape as the model client, and for the same reason: someone
cloning this repo has no OAuth app of their own, and a login wall they cannot
pass would make the project unopenable. The fallback is not a weaker mode. Both
paths return an id from `currentUserId()`, and every query is filtered by
whatever it returns, so enforcement is byte-for-byte identical. What differs is
whether the identity was PROVEN or merely ASSERTED, which is why the sidebar
labels it rather than hiding it.

With OAuth on, `currentUserId()` returns null for an unauthenticated request
rather than falling back. That distinction is the whole point: a fallback there
would mean an unauthenticated caller quietly became somebody, and every ownership
check downstream would then pass for that somebody. API routes answer 401, pages
redirect to sign-in, and the demo cookie stops working entirely.

Sessions are JWT rather than a database adapter. An adapter means four more
tables and a second source of truth about who exists, to support a flow with no
profile page and no account settings. The user id is `provider:providerAccountId`
and never the email address, because email is re-assignable and a mandate is
authority over money — it must not follow an address that changed hands.

Adding all of this touched one function. That is the payoff from having built the
boundary first: the enforcement was already in place and already keyed on the
answer, so authentication only had to supply a better answer.

### Ownership is enforced wherever a mandate is touched

There is no login. There IS a tenancy boundary, and conflating the two would be
the mistake. A login form answers "who are you". What actually protects a
mandate is that every read is filtered by owner and every write checks ownership
before doing anything, server-side, with no route that will hand over someone
else's data for the asking.

So `currentUserId()` is the entire missing auth layer. It reads a cookie today
and a session tomorrow, and nothing else in the codebase changes, because
nothing else asks the question.

The check sits on the money path as well as at the API edge, deliberately. A
mandate id is a bearer token if nothing verifies who is holding it, and ids
travel: they sit in URLs, in tool arguments, and eventually in whatever an MCP
client sends. `authorizeAndExecute` therefore refuses a mandate that is not the
actor's, and refuses BEFORE the engine runs, because a mandate that is not yours
is not a policy question.

Cross-tenant access answers 404 rather than 403. A distinct status code would
confirm to anyone guessing ids which of them are real.

The ledger splits reading from verifying. You see only your own decisions, and
integrity is still checked over the WHOLE chain, everyone's rows included,
because prevHash links every row regardless of owner. A chain covering only your
rows could have another row lifted out from between two of them and still
verify.

`npm run smoke:mandates` proves the boundary rather than asserting it: a second
person cannot spend a mandate that is not theirs, neither person's list contains
the other's, and the refused attempt leaves nothing behind on the target.

### The agent says what it intends to buy before it proposes anything

`announce_plan` is a fourth tool that writes nothing, authorizes nothing and
never reaches the engine. It exists so a person sees the basket and its total up
front instead of watching purchases arrive one at a time with no idea where the
run is heading.

It is deliberately NOT an approval step. The product's whole claim is that the
agent can spend unattended because the mandate already bounded it, and a
per-basket confirmation would quietly concede that the mandate is not enough. So
the plan is a statement of intent that binds nothing: every item still goes to
the engine on its own, and an item named in a plan is refused exactly as it
would be if no plan had been announced. The card says so in as many words, so it
cannot be mistaken for an approved basket.

It also makes the refusal land harder. Under `FORCE_ATTEMPT` the compromised
agent announces the Titan Edge Watch in its plan, and the engine then refuses it
with all four reason codes. The judge watches the theft being declared before
watching it fail.

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

`ModelClient` has three implementations: Gemini, Anthropic, and a scripted one
that replays fixed turns.

The loop speaks one message shape internally, and that shape happens to be
Anthropic's. The Gemini adapter translates in both directions at the boundary
rather than forcing a neutral format through the loop, the scripted client and
the tests. Those translators are pure and unit-tested, because a provider swap
breaks in translation and nowhere else.

*On the choice itself:* Claude is the better-aligned option, since Razorpay Agent
Studio is built on the Claude Agent SDK. Gemini was chosen for its free tier on a
student budget. Because the seam exists, the decision is an env var.

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
the dashboard. **A real Razorpay Payment Link for every authorized purchase**,
created immediately after the order and surfaced as a Pay button on the green
card. Webhook HMAC verification, including `payment_link.paid`. Revocation. Every
number on the Trust Report.

One payment in the demo is completed for real: a link is paid by hand with a test
card, Razorpay delivers `payment_link.paid`, and the settled-spend counter moves
with no simulator anywhere in that path.

Link creation is deliberately non-fatal. An order that succeeded is an authorized
purchase whether or not the link call after it did, so a failure there is logged,
leaves both columns null, and never throws. A Razorpay hiccup must not read as a
policy failure on stage.

**Simulated.** Bulk payment capture for the orders nobody pays by hand. Razorpay
test mode cannot complete a payment server-side without a checkout surface, so
the *event* is synthetic while the *verification* is not: the payload is
Razorpay-shaped, signed with the real webhook secret, and verified by the same
code path a genuine delivery would take.

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
