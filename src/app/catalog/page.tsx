import { prisma } from '@/lib/db'
import { requireActor } from '@/lib/auth/guard'
import { loadMandateSummaries, pickMandate } from '@/lib/mandates/summary'
import { CatalogView, type CatalogMerchant } from '@/components/CatalogView'

/**
 * The catalog the agent shops from.
 */
export const dynamic = 'force-dynamic'

export default async function CatalogPage({ searchParams }: PageProps<'/catalog'>) {
  const requested = (await searchParams).mandate

  const [merchants, summaries] = await Promise.all([
    prisma.merchant.findMany({
      include: { items: { orderBy: { pricePaise: 'asc' } } },
      orderBy: { id: 'asc' },
    }),
    requireActor().then((a) => loadMandateSummaries(a.id)),
  ])

  // Allowed and over-cap belong to one mandate, not to the catalog, so the page
  // marks up against a single named mandate rather than a blur of all of them.
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
