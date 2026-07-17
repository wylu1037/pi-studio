import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { Sidebar } from '@/components/sidebar'
import { QueryProvider } from '@/components/query-provider'
import { ToastHost } from '@/components/toast-host'
import { getPiVersionLabel } from '@/lib/pi-version'
import { ensureTaskScheduler } from '@/lib/scheduler/task-scheduler'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pi Studio — Control panel for pi',
  description:
    'A workbench for managing pi.dev global resources, Agent Profiles, and multi-session chat workflows.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#e9e7e1',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  ensureTaskScheduler()
  const piVersion = getPiVersionLabel()

  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className="antialiased">
        <QueryProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar piVersion={piVersion} />
            <main className="flex-1 overflow-hidden">{children}</main>
          </div>
        </QueryProvider>
        <ToastHost />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
