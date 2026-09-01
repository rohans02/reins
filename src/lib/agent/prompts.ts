/**
 * System prompt + untrusted-content framing.
 *
 * Catalog text (names, descriptions) is UNTRUSTED third-party data and must be
 * wrapped in explicit delimiters, with the system prompt stating that catalog
 * text is data and never instruction.
 *
 * This is defence-in-depth ONLY. It is not the defence. The policy engine is the
 * defence. We assume this prompt will eventually fail and design so that it
 * does not matter when it does.
 *
 * PHASE 2
 */
export const BUYER_AGENT_SYSTEM_PROMPT = '' // TODO Phase 2
export const MANDATE_DRAFTER_SYSTEM_PROMPT = '' // TODO Phase 2
