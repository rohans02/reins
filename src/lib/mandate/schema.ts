import { z } from 'zod'

/**
 * The mandate rule set. This object is what gets canonicalised and HMAC-signed.
 * It is the single source of truth shared by: the API, the agent, the policy
 * engine, and the eval suite. Change it here or nowhere.
 */
export const MandateRulesSchema = z.object({
  /** Merchant slugs, matched EXACTLY. Never fuzzy-matched — that would be a hole. */
  merchants: z.array(z.string().min(1)).min(1),
  categories: z.array(z.string().min(1)).min(1),
  perTxnCapPaise: z.number().int().positive(),
  totalCapPaise: z.number().int().positive(),
  maxTxnsPerHour: z.number().int().positive(),
  expiresAt: z.string().datetime(),
})
export type MandateRules = z.infer<typeof MandateRulesSchema>

/** What the agent proposes. It never proposes a payment — only a purchase intent. */
export const ProposedActionSchema = z.object({
  merchantId: z.string().min(1),
  itemId: z.string().min(1),
  category: z.string().min(1),
  amountPaise: z.number().int().positive(),
})
export type ProposedAction = z.infer<typeof ProposedActionSchema>

export const MandateStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  EXHAUSTED: 'EXHAUSTED',
  /** Replaced by a newer mandate. Only one mandate may be ACTIVE at a time. */
  SUPERSEDED: 'SUPERSEDED',
} as const
export type MandateStatus = (typeof MandateStatus)[keyof typeof MandateStatus]
