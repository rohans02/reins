import { prisma } from '@/lib/db'
import { canonical, canonicalHash } from '@/lib/mandate/canonical'
import { signMandate } from '@/lib/mandate/sign'
import { MandateRulesSchema } from '@/lib/mandate/schema'
import { append } from '@/lib/ledger/append'
import { loadMandateSummaries } from '@/lib/mandates/summary'
import { currentUserId } from '@/lib/auth/session'

/** GET /api/mandates — the CALLER'S mandates, newest first. Never anyone else's. */
export async function GET() {
  const userId = await currentUserId()
  const mandates = await prisma.mandate.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return Response.json({
    mandates: mandates.map((m) => ({
      id: m.id,
      status: m.status,
      intentText: m.intentText,
      rules: JSON.parse(m.rules) as unknown,
      signature: m.signature,
      spentPaise: m.spentPaise,
      totalCapPaise: m.totalCapPaise,
      expiresAt: m.expiresAt,
      createdAt: m.createdAt,
    })),
  })
}

/**
 * POST /api/mandates — canonicalise, HMAC-sign, activate.
 * AI: no. Razorpay: no.
 *
 * This is the ONLY place a mandate becomes ACTIVE, and it happens only on an
 * explicit human action. The drafting model proposes; this endpoint is where a
 * person's approval turns a proposal into authority.
 *
 * Issuance is written to the same append-only ledger as every spend decision, so
 * the audit trail answers "who granted this, and when" as well as "what was
 * spent".
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { intent?: string; rules?: unknown }

  const parsed = MandateRulesSchema.safeParse(body.rules)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_rules', issues: parsed.error.issues }, { status: 400 })
  }
  const rules = parsed.data

  if (rules.perTxnCapPaise > rules.totalCapPaise) {
    return Response.json(
      { error: 'invalid_rules', issues: [{ message: 'Per-transaction cap exceeds the total cap.' }] },
      { status: 400 },
    )
  }

  // CONCURRENT MANDATES ARE ALLOWED, AND THAT IS ONLY SAFE BECAUSE THEY ARE ALL
  // VISIBLE.
  //
  // Signing used to supersede every other active mandate. The reason was real:
  // the console showed only the newest one, so an older ACTIVE mandate stayed
  // live and spendable through the API with nothing on screen saying so, and
  // silently orphaned authority is the exact failure this product exists to
  // prevent.
  //
  // Superseding solved that by destroying authority the person never asked to
  // give up, which is a blunt answer to a display problem. The replacement is
  // stricter. /mandates lists every mandate that exists, states the combined
  // exposure across all of them in one number, and revoking is one click from
  // that list. Nothing is hidden, so nothing has to be silently withdrawn.
  //
  // Each mandate stays an independent budget. Caps, velocity and spend are all
  // scoped by mandate id in the engine, so two live mandates cannot borrow
  // headroom from one another.
  const signature = signMandate(rules)

  const userId = await currentUserId()

  const mandate = await prisma.mandate.create({
    data: {
      userId,
      status: 'ACTIVE',
      intentText: body.intent ?? '',
      rules: canonical(rules),
      signature,
      totalCapPaise: rules.totalCapPaise,
      expiresAt: new Date(rules.expiresAt),
      signedAt: new Date(),
    },
  })

  await append({
    mandateId: mandate.id,
    action: 'MANDATE_ISSUED',
    requestedAction: rules,
    verdict: 'ALLOW',
    reasonCodes: [],
    mandateSnapshotHash: canonicalHash(rules),
    idempotencyKey: canonicalHash({ issued: mandate.id }),
    latencyMs: 0,
  })

  // Signing no longer withdraws anything, so the response has to say what else
  // is still able to spend. A person who signs a second mandate should learn it
  // from the confirmation screen, not from a surprise on the ledger.
  const others = await loadMandateSummaries(userId)
  const alsoLive = others.filter((m) => m.live && m.id !== mandate.id).length

  return Response.json(
    { mandateId: mandate.id, signature, status: mandate.status, alsoLive },
    { status: 201 },
  )
}
