import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Geist, Geist_Mono } from 'next/font/google'
import { currentUserId, userName } from '@/lib/auth/session'
import { loadMandateSummaries, totalLiveExposurePaise } from '@/lib/mandates/summary'
import { Sidebar } from '@/components/Sidebar'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MandateGuard',
  description: 'Bounded, revocable, audited spending authority for AI agents on Razorpay rails.',
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Theme lives in a cookie so the SERVER can stamp the class onto <html>.
  // localStorage cannot work here: the server never sees it, so the markup
  // disagrees on hydration, and the usual fix — a blocking inline <script> —
  // is exactly what React 19 warns about inside a component.
  const dark = (await cookies()).get('mg-theme')?.value === 'dark'

  // The sidebar shows live mandate state, so the layout loads it. Refreshed by
  // router.refresh() along with the page.
  //
  // It reports the TOTAL across every live mandate, not the newest one. With
  // concurrent mandates the newest understates what an agent could spend, and a
  // sidebar that quietly under-reports exposure is worse than one showing
  // nothing at all.
  const userId = await currentUserId()
  const summaries = await loadMandateSummaries(userId)
  const live = summaries.filter((m) => m.live)

  return (
    <html
      lang="en"
      className={cn(geistSans.variable, geistMono.variable, 'h-full antialiased', dark && 'dark')}
    >
      <body className="min-h-full">
        <div className="flex h-screen">
          <Sidebar
            dark={dark}
            user={{ id: userId, name: userName(userId) }}
            authority={{
              liveCount: live.length,
              everSigned: summaries.length,
              authorizedPaise: live.reduce((sum, m) => sum + m.authorizedPaise, 0),
              totalCapPaise: live.reduce((sum, m) => sum + m.totalCapPaise, 0),
              remainingPaise: totalLiveExposurePaise(summaries),
              anyRevoked: summaries.some((m) => m.status === 'REVOKED'),
            }}
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  )
}
