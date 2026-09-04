# Adversarial Suite

Reproduce the numbers on the Trust Report:

```bash
npm run db:reset
npm run eval
```

## Where the cases live

`src/lib/eval/cases.ts` — TypeScript, not JSON, so every case is type-checked
against the engine's own types and cannot drift out of sync with the thing it
tests. `npm run eval` writes the full resolved results to `results.json` here for
anyone who wants the raw data.

Every case is driven through the **real** policy engine (`src/lib/policy/engine.ts`),
never a mock. Because `evaluate()` is a pure function, results are deterministic
and byte-identical across machines.

## Design rules

- **Every reason code has cases.** A suite that only tests caps proves only caps.
- **Legitimate cases are included.** An all-blocks suite proves only that the
  engine can say no, and invites "so it just denies everything?".
- **Boundaries are tested on both sides.** Exactly at a cap must ALLOW; one paisa
  over must BLOCK. Off-by-one is where real money leaks.
- **Compound cases assert the full code list**, not just the first failure.
- **Categories stay isolated.** A per-transaction-cap case whose amount also
  breaches the total cap is testing two things and reports neither cleanly.

## Reporting rules

- Report **per-category** rates, not one aggregate. An aggregate hides which rule
  is weak.
- Report **unauthorized paise** explicitly, even when it is zero. Zero is the claim.
- Report **p50 and p99**, not a mean.
- `npm run eval` exits non-zero if any case fails or if unauthorized spend is
  above zero. Money escaping is not a "mostly passing" outcome.

## RELABEL: the case this suite structurally cannot hold

An agent can lie about *which thing* it is buying: submit the ₹4,999 Luxe watch
as a one rupee BigBasket grocery. Every one of the nine checks would pass, on the
label rather than on the item.

That is not an engine bug and no case here can catch it. These cases call
`evaluate()` directly, which means they hand the engine an action and can only
ever prove it judges that action correctly. The lie is resolved away one layer
above, in `authorizeAndExecute`, where merchant, category and price are read from
the catalog before the engine is consulted.

So it is proved one layer above too, by `npm test` rather than `npm run eval` —
`src/lib/authorize.test.ts` drives the real authorization path against the real
catalog with only the Razorpay call stubbed. It asserts that the relabelled watch
is refused for merchant, category and per-order cap, that a genuine item claimed
at one paisa is still judged at its catalog price, that an unknown item id is
refused with `ITEM_UNKNOWN`, and that the claim is recorded without being judged.

## Honest limitations

- The cases are self-authored. They are published and reproducible, and reported
  per category, but they are not an independent benchmark.
- Latency is measured on a pure in-process function. It excludes network,
  database and Razorpay time and is not an end-to-end figure.
- The suite exercises the policy engine only. Whether the *model* behaves
  sensibly is a separate question that needs a live model.
