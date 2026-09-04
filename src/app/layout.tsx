import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import { authEnabled, currentActor } from '@/lib/auth/session'
import { loadMandateSummaries, pickMandate } from '@/lib/mandates/summary'
import { Sidebar } from '@/components/Sidebar'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Reins',
  description: 'Bounded, revocable, audited spending authority for AI agents on Razorpay rails.',
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // A cookie, not localStorage, so the server can stamp the class onto <html>.
  // The server never sees localStorage, so the markup disagrees on hydration.
  const dark = (await cookies()).get('rn-theme')?.value === 'dark'

  // The sidebar shows the mandate the console is working under, so the layout
  // resolves it with the SAME pickMandate the console uses and hands over that
  // one row. Refreshed by router.refresh() along with the page.
  const actor = await currentActor()
  const summaries = actor ? await loadMandateSummaries(actor.id) : []
  const mandate = pickMandate(summaries)

  return (
    <html
      lang="en"
      className={cn(geistSans.variable, geistMono.variable, 'h-full antialiased', dark && 'dark')}
    >
      <body className="min-h-full">
        {!actor ? (
          <main className="min-h-screen">{children}</main>
        ) : (
        <div className="flex h-screen">
          <Sidebar
            dark={dark}
            accountName={authEnabled() && actor.authenticated ? actor.name : null}
            mandate={
              mandate
                ? {
                    status: mandate.status,
                    authorizedPaise: mandate.authorizedPaise,
                    totalCapPaise: mandate.totalCapPaise,
                  }
                : null
            }
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        )}
        <Toaster />
      </body>
    </html>
  )
}
