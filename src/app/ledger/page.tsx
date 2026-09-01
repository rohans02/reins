/**
 * Audit Ledger — proves nothing is hidden and nothing was altered.
 * Dense mono table: seq | time | action | verdict | amount | reasonCodes | latency | hash(8)
 * Plus a live-computed "Chain verified" badge and filter ALL / ALLOWED / BLOCKED.
 * No AI and no Razorpay on this screen — that is the point. Phase 3.
 */
export default function LedgerPage() {
  return <main className="p-8">Audit Ledger — Phase 3</main>
}
