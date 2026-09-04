/**
 * Frozen reason-code vocabulary.
 */
export const REASON_CODES = {
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  MANDATE_NOT_ACTIVE: 'MANDATE_NOT_ACTIVE',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  MANDATE_EXPIRED: 'MANDATE_EXPIRED',
  MERCHANT_NOT_ALLOWLISTED: 'MERCHANT_NOT_ALLOWLISTED',
  CATEGORY_NOT_ALLOWED: 'CATEGORY_NOT_ALLOWED',
  PER_TXN_CAP_EXCEEDED: 'PER_TXN_CAP_EXCEEDED',
  TOTAL_CAP_EXCEEDED: 'TOTAL_CAP_EXCEEDED',
  VELOCITY_LIMIT_EXCEEDED: 'VELOCITY_LIMIT_EXCEEDED',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  /**
   * The agent named an item that is not in the catalog, or is out of stock.
   */
  ITEM_UNKNOWN: 'ITEM_UNKNOWN',
} as const

export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES]

/** Human-readable labels for the console. The LLM explainer is additive, not a replacement. */
export const REASON_CODE_LABELS: Record<ReasonCode, string> = {
  SIGNATURE_INVALID: 'Mandate signature failed verification',
  MANDATE_NOT_ACTIVE: 'Mandate is not active',
  MANDATE_REVOKED: 'Mandate was revoked',
  MANDATE_EXPIRED: 'Mandate has expired',
  MERCHANT_NOT_ALLOWLISTED: 'Merchant is not on the allowlist',
  CATEGORY_NOT_ALLOWED: 'Category is not permitted',
  PER_TXN_CAP_EXCEEDED: 'Exceeds the per-transaction cap',
  TOTAL_CAP_EXCEEDED: 'Exceeds the remaining total cap',
  VELOCITY_LIMIT_EXCEEDED: 'Too many transactions in the window',
  DUPLICATE_REQUEST: 'Duplicate/replayed request',
  ITEM_UNKNOWN: 'No such item in the catalog',
}
