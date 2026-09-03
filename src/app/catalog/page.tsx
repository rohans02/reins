import { prisma } from '@/lib/db'
import { loadMandateSummaries, pickMandate } from '@/lib/mandates/summary'
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

export default async function CatalogPage({ searchParams }: PageProps<'/catalog'>) {
  const requested = (await searchParams).mandate

  const [merchants, summaries] = await Promise.all([
    prisma.merchant.findMany({
      include: { items: { orderBy: { pricePaise: 'asc' } } },
      orderBy: { id: 'asc' },
    }),
    loadMandateSummaries(),
  ])

  // Allowed and over-cap are properties of ONE mandate, not of the catalog, and
  // with several live at once an item can be allowed under one and refused
  // under another. So the screen marks up against a single named mandate rather
  // than blurring them into a union that matches no real authority.
  const mandate = pickMandate(summaries, typeof requested === 'string' ? requested : undefined)
  const rules = mandate?.rules ?? null

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

  return (
    <CatalogView
      merchants={data}
      hasMandate={Boolean(rules)}
      mandateIntent={mandate?.intentText ?? null}
      mandateCount={summaries.filter((m) => m.live).length}
    />
  )
}
