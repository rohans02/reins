import { prisma } from '@/lib/db'

/** GET /api/catalog — the seed catalog for the UI. AI: no. Razorpay: no. */
export async function GET() {
  const items = await prisma.catalogItem.findMany({
    include: { merchant: true },
    orderBy: [{ merchantId: 'asc' }, { pricePaise: 'asc' }],
  })
  return Response.json({ items })
}
