'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { formatINR } from '@/lib/money'

/**
 * Mandate Studio — turn a sentence into a signed, scoped authorization.
 *
 * The model DRAFTS; a human reviews and approves; the server signs. Those are
 * three separate steps on purpose, and the UI keeps them visibly separate — the
 * draft is always editable before it becomes authority.
 *
 * With no API key the draft button is unavailable and the form is filled in by
 * hand. The product still works; it just does not pretend an LLM was involved.
 */

const EXAMPLES = [
  'Let my grocery agent spend ₹3,000 this week at BigBasket and Zepto, max ₹800 per order, groceries only.',
  'Allow ₹1,500 of groceries from Zepto only, ₹500 per order, expires in 3 days.',
  'Up to ₹5,000 at BigBasket for groceries, ₹1,000 per order, 3 orders an hour max.',
]

interface Rules {
  merchants: string[]
  categories: string[]
  perTxnCapPaise: number
  totalCapPaise: number
  maxTxnsPerHour: number
  expiresAt: string
}

function defaultRules(): Rules {
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return {
    merchants: ['bigbasket', 'zepto', 'medplus'],
    categories: ['groceries'],
    perTxnCapPaise: 80_000,
    totalCapPaise: 300_000,
    // 10, not 5: the demo run makes 7 legitimate purchases and velocity is not
    // the rule being showcased. It is still enforced, and still covered by the
    // adversarial suite.
    maxTxnsPerHour: 10,
    expiresAt: in7Days.toISOString(),
  }
}

export default function NewMandatePage() {
  const router = useRouter()
  const [intent, setIntent] = useState(EXAMPLES[0])
  const [rules, setRules] = useState<Rules>(defaultRules())
  const [drafting, setDrafting] = useState(false)
  const [signing, setSigning] = useState(false)

  async function draft() {
    setDrafting(true)
    try {
      const res = await fetch('/api/mandates/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent }),
      })
      const body = (await res.json()) as { rules?: Rules; message?: string }

      if (res.status === 503) {
        toast.info(body.message ?? 'AI drafting unavailable — edit the fields directly.')
        return
      }
      if (!res.ok || !body.rules) throw new Error('Draft failed')

      setRules(body.rules)
      toast.success('Draft ready. Review it before signing.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft failed')
    } finally {
      setDrafting(false)
    }
  }

  async function sign() {
    setSigning(true)
    try {
      const res = await fetch('/api/mandates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent, rules }),
      })
      const body = (await res.json()) as { mandateId?: string; issues?: Array<{ message: string }> }
      if (!res.ok) throw new Error(body.issues?.[0]?.message ?? 'Could not sign the mandate')

      toast.success('Mandate signed and active.')
      router.push('/console')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signing failed')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Mandate Studio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Say what the agent may spend. You approve it once; after that it acts on its own, inside
          these bounds and nowhere else.
        </p>
      </header>

      <section className="space-y-3">
        <Textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={3}
          placeholder="e.g. Let my grocery agent spend ₹3,000 this week…"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => setIntent(ex)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              Example {i + 1}
            </button>
          ))}
          <Button variant="secondary" size="sm" onClick={draft} disabled={drafting}>
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </Button>
        </div>
      </section>

      {/* Review card — every field editable before it becomes authority. */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Review</h2>
          <Badge variant="secondary" className="font-mono text-[10px]">
            unsigned draft
          </Badge>
        </div>

        <Field label="Merchants allowed">
          <Input
            value={rules.merchants.join(', ')}
            onChange={(e) =>
              setRules({ ...rules, merchants: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
            }
            className="font-mono text-sm"
          />
        </Field>

        <Field label="Categories allowed">
          <Input
            value={rules.categories.join(', ')}
            onChange={(e) =>
              setRules({ ...rules, categories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
            }
            className="font-mono text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={`Per transaction — ${formatINR(rules.perTxnCapPaise)}`}>
            <Input
              type="number"
              value={rules.perTxnCapPaise}
              onChange={(e) => setRules({ ...rules, perTxnCapPaise: Number(e.target.value) })}
              className="font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label={`Total cap — ${formatINR(rules.totalCapPaise)}`}>
            <Input
              type="number"
              value={rules.totalCapPaise}
              onChange={(e) => setRules({ ...rules, totalCapPaise: Number(e.target.value) })}
              className="font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label="Max transactions per hour">
            <Input
              type="number"
              value={rules.maxTxnsPerHour}
              onChange={(e) => setRules({ ...rules, maxTxnsPerHour: Number(e.target.value) })}
              className="font-mono text-sm tabular-nums"
            />
          </Field>
          <Field label="Expires">
            <Input
              value={rules.expiresAt}
              onChange={(e) => setRules({ ...rules, expiresAt: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Canonical form (this exact byte sequence is what gets signed)
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px]">
            {JSON.stringify(rules, Object.keys(rules).sort(), 2)}
          </pre>
        </details>

        <Button onClick={sign} disabled={signing} className="w-full">
          {signing ? 'Signing…' : 'Sign & Activate'}
        </Button>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
