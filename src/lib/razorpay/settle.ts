import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { razorpayClient } from './client'

/**
 * ============================================================================
 *  SETTLEMENT — one Payment Link per MERCHANT, once the run is over.
 * ============================================================================
 *
 * Nobody pays per item. You pay a shop. If the agent buys four things at
 * BigBasket and three at Zepto, that is two payments, and modelling it as seven
 * was an artefact of creating a link at the same moment as the order.
 *
 * So orders stay where they belong, in `executePayment`, created the instant the
 * engine authorizes. Links are created here, after the agent has stopped, when
 * the basket for each shop is finally known.
 *
 * The grouping also removes a class of problem rather than working around it.
 * Razorpay throttles link creation, and seven links in fifteen seconds tripped
 * it; two or three do not. An earlier version capped the count instead, which
 * worked but left some cards with a Pay button and some without, for reasons
 * nothing on screen explained.
 *
 * A GROUP ID, not an order id, is the `reference_id`. One link now covers
 * several orders, so the webhook needs to find all of them, and Razorpay's
 * reference field is a single string. Every transaction in a merchant's basket
 * carries the same generated group id, the link quotes it, and settlement marks
 * the whole group paid.
 *
 * NOTHING HERE CAN FAIL A RUN. Every order is already real and already
 * authorized. A link that could not be created is a settlement inconvenience, so
 * failures are logged and skipped, never thrown.
 */

export interface BasketItem {
  itemId: string
  /** Catalog name, so the panel reads as a receipt rather than a list of slugs. */
  name: string
  amountPaise: number
}

export interface MerchantBasket {
  merchantId: string
  amountPaise: number
  itemCount: number
  items: BasketItem[]
  paymentLinkUrl: string | null
}

/** Short, opaque, and comfortably inside Razorpay's reference_id limit. */
function newGroupId(): string {
  return `grp_${randomBytes(8).toString('hex')}`
}

/**
 * Creates one Payment Link per merchant for everything this run authorized.
 *
 * Returns a basket per merchant, in descending amount order, so the console can
 * show the biggest first. Already-settled runs return their existing links
 * rather than making new ones.
 */
export async function settleRun(runId: string): Promise<MerchantBasket[]> {
  const transactions = await prisma.transaction.findMany({
    where: { decision: { agentRunId: runId, verdict: 'ALLOW', action: 'PURCHASE' } },
    include: { decision: true },
  })

  if (transactions.length === 0) return []

  // Merchant comes from the RESOLVED action, the one the catalog supplied and
  // the engine judged. The agent's claimed merchant is evidence and is never
  // used to decide who gets paid.
  const byMerchant = new Map<string, typeof transactions>()
  const itemIdOf = new Map<string, string>()

  for (const t of transactions) {
    const { merchantId, itemId } = JSON.parse(t.decision.requestedAction) as {
      merchantId?: string
      itemId?: string
    }
    if (!merchantId) continue
    if (itemId) itemIdOf.set(t.id, itemId)
    const bucket = byMerchant.get(merchantId) ?? []
    bucket.push(t)
    byMerchant.set(merchantId, bucket)
  }

  // Names come from the catalog, in one query, for the same reason prices do:
  // the ledger stores what was bought, and the catalog is what knows how to say
  // it in words. An id that has since left the catalog falls back to the id.
  const catalog = await prisma.catalogItem.findMany({
    where: { id: { in: [...new Set(itemIdOf.values())] } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(catalog.map((c) => [c.id, c.name]))

  const baskets: MerchantBasket[] = []

  for (const [merchantId, rows] of byMerchant) {
    const amountPaise = rows.reduce((sum, r) => sum + r.amountPaise, 0)
    const items: BasketItem[] = rows.map((r) => {
      const itemId = itemIdOf.get(r.id) ?? ''
      return { itemId, name: nameOf.get(itemId) ?? itemId, amountPaise: r.amountPaise }
    })

    // Idempotent: a run settled twice must not create a second link.
    const existing = rows.find((r) => r.razorpayPaymentLinkUrl)
    if (existing) {
      baskets.push({
        merchantId,
        amountPaise,
        itemCount: rows.length,
        items,
        paymentLinkUrl: existing.razorpayPaymentLinkUrl,
      })
      continue
    }

    const groupId = newGroupId()

    try {
      // The SDK marks `customer` as required on the create body. The API does
      // not, and inventing a name, email and phone to satisfy a type would put
      // fabricated personal data on a real Razorpay object.
      const params = {
        amount: amountPaise,
        currency: 'INR',
        reference_id: groupId,
        description: `${rows.length} item${rows.length === 1 ? '' : 's'} from ${merchantId}`,
        notes: {
          mandateId: rows[0].decision.mandateId,
          agentRunId: runId,
          merchantId,
          orderIds: rows.map((r) => r.razorpayOrderId).join(','),
        },
        notify: { sms: false, email: false },
        reminder_enable: false,
      }

      const link = await razorpayClient().paymentLink.create(
        params as unknown as Parameters<
          ReturnType<typeof razorpayClient>['paymentLink']['create']
        >[0],
      )

      await prisma.transaction.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          paymentGroupId: groupId,
          razorpayPaymentLinkId: link.id,
          razorpayPaymentLinkUrl: link.short_url,
        },
      })

      baskets.push({
        merchantId,
        amountPaise,
        itemCount: rows.length,
        items,
        paymentLinkUrl: link.short_url,
      })
    } catch (err) {
      console.warn(
        `[reins] payment link failed for ${merchantId} on run ${runId}; the orders stand.`,
        err instanceof Error ? err.message : err,
      )
      baskets.push({ merchantId, amountPaise, itemCount: rows.length, items, paymentLinkUrl: null })
    }
  }

  return baskets.sort((a, b) => b.amountPaise - a.amountPaise)
}
