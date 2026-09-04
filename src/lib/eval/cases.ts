import type { MandateRules, MandateStatus, ProposedAction } from '@/lib/mandate/schema'
import { REASON_CODES, type ReasonCode } from '@/lib/policy/reason-codes'
import type { Verdict } from '@/lib/policy/engine'

/**
 * The adversarial suite.
 */

export const BASE_RULES: MandateRules = {
  merchants: ['bigbasket', 'zepto', 'medplus'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 5,
  expiresAt: '2026-12-31T00:00:00.000Z',
}

export const EVAL_NOW = new Date('2026-09-02T10:00:00.000Z')

export interface EvalCase {
  id: string
  category: string
  description: string
  /** Overrides applied to BASE_RULES before signing. */
  rules?: Partial<MandateRules>
  status?: MandateStatus
  /** Applied AFTER signing, to forge a mandate the signature no longer covers. */
  tamperAfterSigning?: Partial<MandateRules>
  ledger?: { spentPaise?: number; recentTxnCount?: number; replay?: boolean }
  now?: Date
  action: ProposedAction
  expectedVerdict: Verdict
  expectedReasonCodes: ReasonCode[]
}

const groceries = (merchantId: string, itemId: string, amountPaise: number): ProposedAction => ({
  merchantId,
  itemId,
  category: 'groceries',
  amountPaise,
})

// ---------------------------------------------------------------------------
// 1. Legitimate purchases — these MUST be allowed
// ---------------------------------------------------------------------------
const ALLOWED: EvalCase[] = [
  ['ok-01', 'bigbasket', 'bb-atta-5', 28_500, 'Ordinary in-bounds grocery purchase'],
  ['ok-02', 'zepto', 'zp-milk-2', 13_800, 'Second allowlisted merchant'],
  ['ok-03', 'bigbasket', 'bb-dal-1', 18_500, 'Cheap staple'],
  ['ok-04', 'zepto', 'zp-bread-1', 5_500, 'Smallest basket item'],
  ['ok-05', 'bigbasket', 'bb-rice-1', 14_500, 'The compliant substitute for the 10kg sack'],
  ['ok-06', 'zepto', 'zp-tea-500', 27_500, 'Mid-priced item'],
].map(([id, merchant, item, amount, description]) => ({
  id: id as string,
  category: 'LEGITIMATE',
  description: description as string,
  action: groceries(merchant as string, item as string, amount as number),
  expectedVerdict: 'ALLOW' as Verdict,
  expectedReasonCodes: [],
}))

// Boundary cases that must ALLOW — the expensive half of off-by-one.
const BOUNDARY_ALLOW: EvalCase[] = [
  {
    id: 'ok-07',
    category: 'LEGITIMATE',
    description: 'Amount exactly equal to the per-transaction cap',
    action: groceries('bigbasket', 'bb-exact', 80_000),
    expectedVerdict: 'ALLOW',
    expectedReasonCodes: [],
  },
  {
    id: 'ok-08',
    category: 'LEGITIMATE',
    description: 'Spend that lands exactly on the total cap',
    ledger: { spentPaise: 250_000 },
    action: groceries('bigbasket', 'bb-exact-total', 50_000),
    expectedVerdict: 'ALLOW',
    expectedReasonCodes: [],
  },
  {
    id: 'ok-09',
    category: 'LEGITIMATE',
    description: 'One below the velocity limit',
    ledger: { recentTxnCount: 4 },
    action: groceries('zepto', 'zp-eggs-12', 9_900),
    expectedVerdict: 'ALLOW',
    expectedReasonCodes: [],
  },
  {
    id: 'ok-10',
    category: 'LEGITIMATE',
    description: 'Transactions exist but have aged out of the velocity window',
    ledger: { recentTxnCount: 0, spentPaise: 40_000 },
    action: groceries('bigbasket', 'bb-sugar-1', 5_900),
    expectedVerdict: 'ALLOW',
    expectedReasonCodes: [],
  },
]

// ---------------------------------------------------------------------------
// 2. Per-transaction cap
// ---------------------------------------------------------------------------
const PER_TXN: EvalCase[] = [80_001, 85_000, 99_000, 150_000, 200_000, 299_999, 250_000, 80_100].map(
  (amountPaise, i) => ({
    id: `cap-${String(i + 1).padStart(2, '0')}`,
    category: REASON_CODES.PER_TXN_CAP_EXCEEDED,
    description: `${amountPaise} paise against an 80000 paise per-transaction cap`,
    action: groceries('bigbasket', `bb-over-${i}`, amountPaise),
    expectedVerdict: 'BLOCK' as Verdict,
    expectedReasonCodes: [REASON_CODES.PER_TXN_CAP_EXCEEDED],
  }),
)

// ---------------------------------------------------------------------------
// 3. Total cap — each starts from a different amount already spent
// ---------------------------------------------------------------------------
const TOTAL_CAP: EvalCase[] = [
  [250_000, 50_001],
  [290_000, 28_500],
  [299_999, 2],
  [300_000, 5_500],
  [150_000, 79_000 + 71_001],
  [280_000, 25_000],
  [200_000, 79_000],
  [295_000, 9_900],
]
  .filter(([spent, amount]) => amount <= BASE_RULES.perTxnCapPaise && spent + amount > BASE_RULES.totalCapPaise)
  .map(([spentPaise, amountPaise], i) => ({
    id: `total-${String(i + 1).padStart(2, '0')}`,
    category: REASON_CODES.TOTAL_CAP_EXCEEDED,
    description: `${spentPaise} already spent, +${amountPaise} exceeds the 300000 total`,
    ledger: { spentPaise },
    action: groceries('zepto', `zp-total-${i}`, amountPaise),
    expectedVerdict: 'BLOCK' as Verdict,
    expectedReasonCodes: [REASON_CODES.TOTAL_CAP_EXCEEDED],
  }))

// ---------------------------------------------------------------------------
// 4. Merchant allowlist — including near-miss slugs, which is how this leaks
// ---------------------------------------------------------------------------
const MERCHANTS: EvalCase[] = [
  'luxe-store',
  'BigBasket',
  'bigbasket ',
  'big-basket',
  'bigbasket-store',
  'zeptoo',
  'amazon',
  '',
].map((merchantId, i) => ({
  id: `merch-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.MERCHANT_NOT_ALLOWLISTED,
  description: `Merchant slug "${merchantId}" is not on the allowlist (exact match only)`,
  action: groceries(merchantId, `x-${i}`, 20_000),
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.MERCHANT_NOT_ALLOWLISTED],
}))

// ---------------------------------------------------------------------------
// 5. Category allowlist — allowlisted merchant, disallowed category
// ---------------------------------------------------------------------------
const CATEGORIES: EvalCase[] = [
  'pharmacy',
  'fashion',
  'electronics',
  'alcohol',
  'Groceries',
  'grocery',
  'gift-cards',
  '',
].map((category, i) => ({
  id: `cat-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.CATEGORY_NOT_ALLOWED,
  description: `Category "${category}" at an allowlisted merchant`,
  action: { merchantId: 'medplus', itemId: `mp-${i}`, category, amountPaise: 20_000 },
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.CATEGORY_NOT_ALLOWED],
}))

// ---------------------------------------------------------------------------
// 6. Expiry
// ---------------------------------------------------------------------------
const EXPIRED: EvalCase[] = [
  '2026-09-02T10:00:00.001Z',
  '2026-09-02T11:00:00.000Z',
  '2026-09-03T00:00:00.000Z',
  '2027-01-01T00:00:00.000Z',
  '2030-01-01T00:00:00.000Z',
].map((now, i) => ({
  id: `exp-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.MANDATE_EXPIRED,
  description: `Mandate expired before ${now}`,
  rules: { expiresAt: '2026-09-02T10:00:00.000Z' },
  now: new Date(now),
  action: groceries('bigbasket', `bb-exp-${i}`, 20_000),
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.MANDATE_EXPIRED],
}))

// ---------------------------------------------------------------------------
// 7. Status — revoked and other non-active states
// ---------------------------------------------------------------------------
const REVOKED: EvalCase[] = [5_500, 20_000, 28_500, 79_999].map((amountPaise, i) => ({
  id: `rev-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.MANDATE_REVOKED,
  description: `Revoked mandate refuses an otherwise perfectly valid ${amountPaise} paise purchase`,
  status: 'REVOKED' as MandateStatus,
  action: groceries('bigbasket', `bb-rev-${i}`, amountPaise),
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.MANDATE_REVOKED],
}))

const NOT_ACTIVE: EvalCase[] = (['DRAFT', 'EXPIRED', 'EXHAUSTED'] as MandateStatus[]).map(
  (status, i) => ({
    id: `stat-${String(i + 1).padStart(2, '0')}`,
    category: REASON_CODES.MANDATE_NOT_ACTIVE,
    description: `Mandate in ${status} state cannot authorize`,
    status,
    action: groceries('zepto', `zp-stat-${i}`, 12_000),
    expectedVerdict: 'BLOCK' as Verdict,
    expectedReasonCodes: [REASON_CODES.MANDATE_NOT_ACTIVE],
  }),
)

// ---------------------------------------------------------------------------
// 8. Velocity
// ---------------------------------------------------------------------------
const VELOCITY: EvalCase[] = [5, 6, 9, 20].map((recentTxnCount, i) => ({
  id: `vel-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.VELOCITY_LIMIT_EXCEEDED,
  description: `${recentTxnCount} transactions already inside the hour window (limit 5)`,
  ledger: { recentTxnCount },
  action: groceries('zepto', `zp-vel-${i}`, 9_900),
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.VELOCITY_LIMIT_EXCEEDED],
}))

// ---------------------------------------------------------------------------
// 9. Signature — the mandate is edited after it was signed
// ---------------------------------------------------------------------------
const TAMPERED: EvalCase[] = [
  { perTxnCapPaise: 10_000_000 },
  { totalCapPaise: 99_000_000 },
  { merchants: ['bigbasket', 'zepto', 'medplus', 'luxe-store'] },
  { categories: ['groceries', 'fashion'] },
  { maxTxnsPerHour: 9_999 },
].map((tamperAfterSigning, i) => ({
  id: `sig-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.SIGNATURE_INVALID,
  description: `Rules edited after signing: ${JSON.stringify(tamperAfterSigning)}`,
  tamperAfterSigning,
  action: groceries('bigbasket', `bb-sig-${i}`, 20_000),
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.SIGNATURE_INVALID],
}))

// ---------------------------------------------------------------------------
// 10. Replay
// ---------------------------------------------------------------------------
const REPLAY: EvalCase[] = [5_500, 20_000, 28_500].map((amountPaise, i) => ({
  id: `dup-${String(i + 1).padStart(2, '0')}`,
  category: REASON_CODES.DUPLICATE_REQUEST,
  description: `Replayed request for ${amountPaise} paise`,
  ledger: { replay: true },
  action: groceries('bigbasket', `bb-dup-${i}`, amountPaise),
  expectedVerdict: 'BLOCK' as Verdict,
  expectedReasonCodes: [REASON_CODES.DUPLICATE_REQUEST],
}))

// ---------------------------------------------------------------------------
// 11. Compound — one attempt, several rules broken. Assert the FULL list.
// ---------------------------------------------------------------------------
const COMPOUND: EvalCase[] = [
  {
    id: 'multi-01',
    category: 'COMPOUND',
    description: 'The Luxe watch: wrong merchant, wrong category, over per-txn AND over total',
    action: { merchantId: 'luxe-store', itemId: 'lx-watch-1', category: 'fashion', amountPaise: 499_900 },
    expectedVerdict: 'BLOCK',
    expectedReasonCodes: [
      REASON_CODES.MERCHANT_NOT_ALLOWLISTED,
      REASON_CODES.CATEGORY_NOT_ALLOWED,
      REASON_CODES.PER_TXN_CAP_EXCEEDED,
      REASON_CODES.TOTAL_CAP_EXCEEDED,
    ],
  },
  {
    id: 'multi-02',
    category: 'COMPOUND',
    description: 'Revoked mandate AND an off-allowlist merchant',
    status: 'REVOKED',
    action: groceries('amazon', 'az-1', 20_000),
    expectedVerdict: 'BLOCK',
    expectedReasonCodes: [REASON_CODES.MANDATE_REVOKED, REASON_CODES.MERCHANT_NOT_ALLOWLISTED],
  },
  {
    id: 'multi-03',
    category: 'COMPOUND',
    description: 'Expired AND over the per-transaction cap',
    rules: { expiresAt: '2026-09-01T00:00:00.000Z' },
    action: groceries('bigbasket', 'bb-x', 120_000),
    expectedVerdict: 'BLOCK',
    expectedReasonCodes: [REASON_CODES.MANDATE_EXPIRED, REASON_CODES.PER_TXN_CAP_EXCEEDED],
  },
  {
    id: 'multi-04',
    category: 'COMPOUND',
    description: 'Tampered signature AND velocity exhausted',
    tamperAfterSigning: { perTxnCapPaise: 5_000_000 },
    ledger: { recentTxnCount: 7 },
    action: groceries('bigbasket', 'bb-y', 20_000),
    expectedVerdict: 'BLOCK',
    expectedReasonCodes: [REASON_CODES.SIGNATURE_INVALID, REASON_CODES.VELOCITY_LIMIT_EXCEEDED],
  },
]

export const EVAL_CASES: EvalCase[] = [
  ...ALLOWED,
  ...BOUNDARY_ALLOW,
  ...PER_TXN,
  ...TOTAL_CAP,
  ...MERCHANTS,
  ...CATEGORIES,
  ...EXPIRED,
  ...REVOKED,
  ...NOT_ACTIVE,
  ...VELOCITY,
  ...TAMPERED,
  ...REPLAY,
  ...COMPOUND,
]
