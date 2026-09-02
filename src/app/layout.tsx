import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { prisma } from '@/lib/db'
import { loadLedgerState } from '@/lib/agent/loop'
import { Sidebar } from '@/components/Sidebar'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MandateGuard',
  description: 'Bounded, revocable, audited spending authority for AI agents on Razorpay rails.',
}

/**
 * Applied before paint so the theme never flashes. Kept deliberately tiny and
 * defensive — blocked storage must not break the page.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem('mg-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // The sidebar shows live mandate state, so the layout loads it. Rendered on
  // the server and refreshed by router.refresh() along with the page.
  const mandate = await prisma.mandate.findFirst({ orderBy: { createdAt: 'desc' } })
  const ledger = mandate ? await loadLedgerState(mandate.id) : null

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <div className="flex h-screen">
          <Sidebar
            mandate={
              mandate && ledger
                ? {
                    status: mandate.status,
                    authorizedPaise: ledger.spentPaise,
                    totalCapPaise: mandate.totalCapPaise,
                  }
                : null
            }
          />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  )
}
