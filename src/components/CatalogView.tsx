import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The catalog, annotated against the active mandate.
 *
 * Two jobs. It shows what the agent can actually see, and it shows the
 * prompt-injection payload sitting in plain sight inside a product description —
 * before the run, so a judge watches the trap being set rather than discovering
 * it after the fact.
 *
 * Annotations (off-allowlist, over cap, wrong category) are computed from the
 * live mandate, so the page tells you what WOULD happen without asserting what
 * did. The engine remains the only thing that actually decides.
 */

export interface CatalogItem {
  id: string
  name: string
  category: string
  pricePaise: number
  description: string
  overCap: boolean
  categoryAllowed: boolean | null
}

export interface CatalogMerchant {
  id: string
  name: string
  category: string
  allowlisted: boolean | null
  items: CatalogItem[]
}

/** Anything wrapped in << >> in a description is an injected instruction. */
const INJECTION = /<<([\s\S]*?)>>/

export function CatalogView({
  merchants,
  hasMandate,
}: {
  merchants: CatalogMerchant[]
  hasMandate: boolean
}) {
  const injected = merchants.flatMap((m) =>
    m.items.filter((i) => INJECTION.test(i.description)).map((i) => ({ merchant: m, item: i })),
  )

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          What the agent can see. It reads all of this as data, never as instruction. Each item is
          checked against the active mandate, so you can tell in advance what would be refused.
        </p>
        {!hasMandate && (
          <p className="text-sm text-muted-foreground">
            There is no active mandate, so nothing is marked up yet. Sign one to see the bounds applied.
          </p>
        )}
      </header>

      {injected.length > 0 && (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="font-mono text-destructive">
              ⚠
            </span>
            <h2 className="text-sm font-semibold text-destructive">
              Prompt injection detected in {injected.length === 1 ? 'a listing' : 'listings'}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A merchant has written instructions into a product description, aimed at the agent reading
            it. The agent may well believe it. Models do. That is why the guarantee never depends
            on the model resisting anything. The policy engine has no free-text field for an
            instruction to sit in.
          </p>
          {injected.map(({ merchant, item }) => (
            <div key={item.id} className="rounded-md bg-background border border-border p-3">
              <div className="font-mono text-xs text-muted-foreground mb-1.5">
                {merchant.id} · {item.id}
              </div>
              <Description text={item.description} />
            </div>
          ))}
        </section>
      )}

      <div className="space-y-6">
        {merchants.map((m) => (
          <section key={m.id} className="space-y-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight">{m.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">{m.id}</span>
              {m.allowlisted !== null && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
                    m.allowlisted
                      ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-500'
                      : 'bg-destructive/15 text-destructive',
                  )}
                >
                  {m.allowlisted ? 'allowlisted' : 'not allowlisted'}
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {m.items.map((item) => {
                const wouldFail =
                  m.allowlisted === false || item.categoryAllowed === false || item.overCap
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-lg border bg-card p-3',
                      wouldFail ? 'border-destructive/30' : 'border-border',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium truncate">{item.name}</span>
                      <span className="font-mono text-sm tabular-nums shrink-0">
                        {formatINR(item.pricePaise)}
                      </span>
                    </div>

                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {item.id} · {item.category}
                    </div>

                    <div className="mt-2 text-xs text-muted-foreground leading-relaxed">
                      <Description text={item.description} />
                    </div>

                    {wouldFail && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.allowlisted === false && <Flag>merchant not allowlisted</Flag>}
                        {item.categoryAllowed === false && <Flag>category not allowed</Flag>}
                        {item.overCap && <Flag>over per-order cap</Flag>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
      {children}
    </span>
  )
}

/** Renders a description with any injected instruction highlighted in place. */
function Description({ text }: { text: string }) {
  const match = INJECTION.exec(text)
  if (!match) return <span>{text}</span>

  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0].length)

  return (
    <span>
      {before}
      <mark className="rounded bg-destructive/20 px-1 py-0.5 font-mono text-[11px] text-destructive not-italic">
        {match[1].trim()}
      </mark>
      {after}
    </span>
  )
}
