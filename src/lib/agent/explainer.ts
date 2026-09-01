/**
 * Turns a deterministic BLOCK decision into one sentence (<= 25 words) for the console.
 *
 * CRITICAL: this runs strictly AFTER the verdict is decided. It never influences
 * the verdict. If this call fails or the API is down, the block still happened —
 * the UI just shows raw reason codes instead of prose. The AI is on the
 * explanation path, never the enforcement path.
 *
 * PHASE 3
 */
export async function explainBlock(_args: {
  reasonCodes: string[]
  amountPaise: number
  perTxnCapPaise: number
  merchantId: string
}): Promise<string> {
  throw new Error('explainBlock(): not implemented — Phase 3')
}
