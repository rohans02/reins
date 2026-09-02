import { prisma } from '@/lib/db'
import { canonical, canonicalHash } from '@/lib/mandate/canonical'
import { signMandate } from '@/lib/mandate/sign'
import { MandateRulesSchema } from '@/lib/mandate/schema'
import { append } from '@/lib/ledger/append'

/** GET /api/mandates — every mandate, newest first. */
export async function GET() {
  const mandates = await prisma.mandate.findMany({ orderBy: { createdAt: 'desc' } })
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

  const signature = signMandate(rules)

  const mandate = await prisma.mandate.create({
    data: {
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

  return Response.json({ mandateId: mandate.id, signature, status: mandate.status }, { status: 201 })
}
