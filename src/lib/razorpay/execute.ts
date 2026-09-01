/**
 * ============================================================================
 *  THE SINGLE CHOKE POINT TO MONEY.
 * ============================================================================
 *
 * This is the ONLY function in the codebase that calls Razorpay to move value.
 * It accepts a persisted Decision row and refuses to act unless
 * decision.verdict === 'ALLOW'. There is no other path.
 *
 * Keeping this a single narrow function is an architecture answer you can give
 * at panel in one sentence.
 *
 * Idempotency key = the decision hash, so a retry can never double-charge.
 *
 * PHASE 2
 */
export async function executePayment(_decisionId: string): Promise<{ razorpayOrderId: string }> {
  throw new Error('executePayment(): not implemented — Phase 2')
}
