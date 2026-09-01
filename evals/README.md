# Adversarial Suite

Reproduce the numbers on the Trust Report:

```bash
npm run db:reset
npm run eval
```

Every case is driven through the **real** policy engine (`src/lib/policy/engine.ts`),
never a mock. Because `evaluate()` is a pure function, results are deterministic
and byte-identical across machines.

## Reporting rules (Track 1 bar)

- Report **per-category** block rates, not a single aggregate. An aggregate hides
  which category is weak.
- Report **unauthorized paise** explicitly, even when it is 0.
- Include **legitimately-allowed** cases. A suite that is 100% blocks proves only
  that the engine can say no, and invites "so it just denies everything?".
- Report **p50 and p99** authorization latency, not just the mean.
- State honest limitations here and in the root README.
