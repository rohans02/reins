import { redirect } from 'next/navigation'
import { signIn } from '@/lib/auth/authjs'
import { configuredProviders, type ConfiguredProvider } from '@/lib/auth/providers'
import { currentActor } from '@/lib/auth/session'
import { formatINR } from '@/lib/money'

/**
 * Sign in — and the first thing a judge sees once auth is on.
 */
export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  const providers = configuredProviders()
  const actor = await currentActor()

  if (providers.length === 0 || actor) redirect('/console')

  return (
    // Sign-in comes FIRST in the DOM and moves right only on a wide screen.
    // Stacked on a phone, the button belongs above the argument rather than
    // below a full screen of it.
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[1.15fr_1fr]">
      <div className="min-w-0 flex items-center justify-center p-8 lg:p-12 border-b lg:border-b-0 lg:border-l border-border lg:order-2">
        <div className="w-full max-w-xs space-y-6 rn-enter">
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your mandates are yours. Every screen and every route is scoped to the account that
              signed them.
            </p>
          </div>

          <div className="space-y-2">
            {providers.map((p) => (
              <ProviderButton key={p.id} provider={p} />
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-4">
            We read your account id and display name, nothing else. The id is what a mandate
            belongs to, and it is never your email address, because an email can change hands and a
            mandate is authority over money.
          </p>
        </div>
      </div>

      <Pitch />
    </div>
  )
}

function ProviderButton({ provider }: { provider: ConfiguredProvider }) {
  return (
    <form
      action={async () => {
        'use server'
        await signIn(provider.id, { redirectTo: '/console' })
      }}
    >
      <button
        type="submit"
        className="flex w-full h-11 items-center justify-center gap-2.5 rounded-lg border border-border bg-card text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {provider.id === 'github' ? <GitHubMark /> : <GoogleMark />}
        Continue with {provider.label}
      </button>
    </form>
  )
}

function Pitch() {
  return (
    <div className="relative min-w-0 flex flex-col justify-between overflow-hidden p-8 lg:p-12 lg:order-1">
      {/* A faint grid, kept behind everything and well under the text contrast.
          It reads as graph paper, which suits a ledger. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative space-y-1">
        <div className="text-lg font-semibold tracking-tight">Reins</div>
        <div className="text-[11px] text-muted-foreground">Hand over the reins. Keep hold of them.</div>
      </div>

      <div className="relative min-w-0 space-y-8 py-12 max-w-lg">
        <div className="space-y-4">
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-[1.15]">
            The LLM plans.
            <br />
            The code decides.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Give an AI agent real spending power on Razorpay rails, bounded by a signed mandate and
            enforced in code rather than in a prompt. The agent holds no credentials and has no path
            to money. Every purchase is a proposal to a pure function that answers allow or block.
          </p>
          <p className="text-sm leading-relaxed">
            A prompt injection can convince the model of anything it likes. It still cannot move a
            rupee.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            An example of what the console shows
          </div>
          <SampleVerdict
            allowed
            merchant="bigbasket"
            item="Aashirvaad Atta 5kg"
            amountPaise={28_500}
          />
          <SampleVerdict
            merchant="luxe-store"
            item="Titan Edge Watch"
            amountPaise={499_900}
            codes={[
              'MERCHANT_NOT_ALLOWLISTED',
              'CATEGORY_NOT_ALLOWED',
              'PER_TXN_CAP_EXCEEDED',
              'TOTAL_CAP_EXCEEDED',
            ]}
          />
        </div>
      </div>

      <div className="relative font-mono text-[10px] text-muted-foreground">
        razorpay ai buildathon · track 1
      </div>
    </div>
  )
}

function SampleVerdict({
  allowed = false,
  merchant,
  item,
  amountPaise,
  codes = [],
}: {
  allowed?: boolean
  merchant: string
  item: string
  amountPaise: number
  codes?: string[]
}) {
  return (
    <div
      className={
        'rounded-lg border bg-card p-3 ' +
        (allowed
          ? 'border-border border-l-[3px] border-l-emerald-600'
          : 'border-destructive/50 border-l-[3px] border-l-destructive')
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={
              'font-mono text-sm shrink-0 ' + (allowed ? 'text-emerald-600' : 'text-destructive')
            }
          >
            {allowed ? '✓' : '✕'}
          </span>
          <span className="font-mono text-xs truncate">{merchant}</span>
          <span className="text-xs text-muted-foreground truncate">{item}</span>
        </div>
        <span
          className={
            'font-mono text-xs tabular-nums shrink-0 ' + (allowed ? '' : 'text-destructive')
          }
        >
          {formatINR(amountPaise)}
        </span>
      </div>

      {codes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {codes.map((c) => (
            <span
              key={c}
              className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[9px] text-destructive"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* Brand marks are inlined rather than pulled from a CDN. The published app must
   not depend on a third-party asset host to render its own sign-in button. */

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-4 shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}
