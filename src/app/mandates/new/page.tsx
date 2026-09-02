'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Mandate Studio — turn a sentence into a signed, scoped authorization.
 *
 * The model DRAFTS; a human reviews and approves; the server signs. Those are
 * three separate steps on purpose, and the UI keeps them visibly separate — the
 * draft stays editable right up until it becomes authority.
 *
 * Signing gets its own moment. It is the conceptual heart of the product:
 * intent becomes a cryptographic object. Making it feel like saving a settings
 * form would undersell the one idea the whole demo rests on, so the signature is
 * shown, in full, before you move on.
 *
 * With no API key the draft step is unavailable and the form is filled in by
 * hand. The product still works; it just does not pretend an LLM was involved.
 */

const EXAMPLES = [
  {
    label: 'Weekly groceries',
    text: 'Let my grocery agent spend ₹3,000 this week at BigBasket and Zepto, max ₹800 per order, groceries only.',
  },
  {
    label: 'Tight & short-lived',
    text: 'Allow ₹1,500 of groceries from Zepto only, ₹500 per order, expires in 3 days.',
  },
  {
    label: 'Single merchant',
    text: 'Up to ₹5,000 at BigBasket for groceries, ₹1,000 per order, 3 orders an hour max.',
  },
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
  const in50Minutes = new Date(Date.now() + 50 * 60 * 1000)
  return {
    merchants: ['bigbasket', 'zepto', 'medplus'],
    categories: ['groceries'],
    perTxnCapPaise: 80_000,
    totalCapPaise: 300_000,
    // 10, not 5: a full demo run makes 7 legitimate purchases and velocity is
    // not the rule being showcased. It is still enforced, and still covered by
    // the adversarial suite.
    maxTxnsPerHour: 10,
    // Under an hour so the console countdown ticks in minutes and seconds
    // rather than sitting at "168h".
    expiresAt: in50Minutes.toISOString(),
  }
}

type Phase = 'editing' | 'signing' | 'signed'

export default function NewMandatePage() {
  const router = useRouter()
  const [intent, setIntent] = useState(EXAMPLES[0].text)
  const [rules, setRules] = useState<Rules>(defaultRules())
  const [drafting, setDrafting] = useState(false)
  const [phase, setPhase] = useState<Phase>('editing')
  const [signature, setSignature] = useState<string | null>(null)

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
    setPhase('signing')
    try {
      const res = await fetch('/api/mandates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent, rules }),
      })
      const body = (await res.json()) as {
        mandateId?: string
        signature?: string
        issues?: Array<{ message: string }>
      }
      if (!res.ok) throw new Error(body.issues?.[0]?.message ?? 'Could not sign the mandate')

      setSignature(body.signature ?? null)
      setPhase('signed')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Signing failed')
      setPhase('editing')
    }
  }

  if (phase === 'signed') {
    return <Signed rules={rules} intent={intent} signature={signature} />
  }

  const canonical = JSON.stringify(rules, Object.keys(rules).sort(), 2)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Mandate Studio</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Say what the agent may spend. You approve it once; after that it acts on its own, inside
          these bounds and nowhere else.
        </p>
      </header>

      <Step n={1} title="State the intent" hint="Plain language. The model drafts; it never grants.">
        <Textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={3}
          className="text-sm"
          placeholder="e.g. Let my grocery agent spend ₹3,000 this week…"
        />
        <div className="flex flex-wrap items-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setIntent(ex.text)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {ex.label}
            </button>
          ))}
          <Button variant="secondary" size="sm" onClick={draft} disabled={drafting}>
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </Button>
        </div>
      </Step>

      <Step n={2} title="Review the bounds" hint="Editable until the moment you sign.">
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <Field label="Merchants allowed">
            <Input
              value={rules.merchants.join(', ')}
              onChange={(e) =>
                setRules({
                  ...rules,
                  merchants: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })
              }
              className="font-mono text-sm"
            />
          </Field>

          <Field label="Categories allowed">
            <Input
              value={rules.categories.join(', ')}
              onChange={(e) =>
                setRules({
                  ...rules,
                  categories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })
              }
              className="font-mono text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={`Per order — ${formatINR(rules.perTxnCapPaise)}`}>
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
            <Field label="Orders per hour">
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
        </div>
      </Step>

      <Step
        n={3}
        title="Sign it"
        hint="These exact bytes are HMAC-signed. Change one character afterwards and every purchase is refused."
      >
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 font-mono text-[11px] leading-relaxed">
          {canonical}
        </pre>
        <Button onClick={sign} disabled={phase === 'signing'} className="w-full h-10 text-sm">
          {phase === 'signing' ? 'Signing…' : 'Sign & Activate'}
        </Button>
      </Step>
    </div>
  )
}

function Signed({
  rules,
  intent,
  signature,
}: {
  rules: Rules
  intent: string
  signature: string | null
}) {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="rounded-lg border border-border bg-card p-8 space-y-6 mg-block-enter">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-emerald-600/15 font-mono text-emerald-600"
          >
            ✓
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Mandate signed</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Authority is now in force. The agent can act inside these bounds and nowhere else.
            </p>
          </div>
          <span className="ml-auto rounded-full bg-emerald-600/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
            active
          </span>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-border pl-3">
          &ldquo;{intent}&rdquo;
        </p>

        <div>
          <div className="text-[11px] text-muted-foreground mb-1.5">
            HMAC-SHA256 over the canonical rules
          </div>
          <code className="block break-all rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
            {signature ?? '—'}
          </code>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-border pt-5">
          <Summary label="Merchants" value={rules.merchants.join(', ')} />
          <Summary label="Categories" value={rules.categories.join(', ')} />
          <Summary label="Per order" value={formatINR(rules.perTxnCapPaise)} />
          <Summary label="Total cap" value={formatINR(rules.totalCapPaise)} />
        </dl>

        <Button render={<Link href="/console" />} nativeButton={false} className="w-full h-10">
          Open Mission Control
        </Button>
      </div>
    </div>
  )
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{n}</span>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      </div>
      <p className={cn('text-xs text-muted-foreground -mt-1.5 pl-6 leading-relaxed')}>{hint}</p>
      <div className="space-y-3 pl-6">{children}</div>
    </section>
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

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs mt-0.5 break-words">{value}</dd>
    </div>
  )
}
