/**
 * The agent's ENTIRE tool surface. Exactly three tools.
 *
 * Note what is NOT here: there is no razorpay tool, no create_order, no
 * http_request, no shell. The agent holds no Razorpay credentials and has no
 * code path to money except by proposing through request_purchase, which lands
 * in the policy engine.
 *
 * PHASE 2
 */
export const AGENT_TOOLS = [
  // search_catalog  — { query?, category?, merchantId?, maxPricePaise? } -> CatalogItem[]
  // get_item        — { itemId } -> CatalogItem
  // request_purchase— { merchantId, itemId, category, amountPaise } -> Decision result
] as const
