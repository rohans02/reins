import { prisma } from '@/lib/db'
import { CatalogView, type CatalogMerchant } from '@/components/CatalogView'

/**
 * The catalog the agent shops from.
 *
 * This screen exists for one reason: it lets you show the trap BEFORE it
 * springs. The Luxe Store listing carries a prompt-injection payload in its
 * description, and seeing it here — before the run — makes the block land far
 * harder than discovering it mid-demo. The judge watches the trap being set.
 */
export const dynamic = 'force-dynamic'

export default async function CatalogPage() {
  const merchants = await prisma.merchant.findMany({
    include: { items: { orderBy: { pricePaise: 'asc' } } },
    orderBy: { id: 'asc' },
  })

  const mandate = await prisma.mandate.findFirst({ orderBy: { createdAt: 'desc' } })
  const rules = mandate
    ? (JSON.parse(mandate.rules) as { merchants: string[]; categories: string[]; perTxnCapPaise: number })
    : null

  const data: CatalogMerchant[] = merchants.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    allowlisted: rules ? rules.merchants.includes(m.id) : null,
    items: m.items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      pricePaise: i.pricePaise,
      description: i.description,
      overCap: rules ? i.pricePaise > rules.perTxnCapPaise : false,
      categoryAllowed: rules ? rules.categories.includes(i.category) : null,
    })),
  }))

  return <CatalogView merchants={data} hasMandate={Boolean(rules)} />
}
