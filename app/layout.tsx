import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { cookies } from 'next/headers'
import { Sidebar } from '@/components/sidebar'
import { QueryProvider } from '@/components/query-provider'
import { ToastHost } from '@/components/toast-host'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  ensureTaskScheduler()
  const piVersion = getPiVersionLabel()
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className="antialiased">
        <TooltipProvider>
          <QueryProvider>
            <SidebarProvider
              defaultOpen={sidebarOpen}
              className="h-svh min-h-0 overflow-hidden"
              style={{ '--sidebar-width': '14rem' } as React.CSSProperties}
            >
              <Sidebar piVersion={piVersion} />
              <main className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden">
                <header className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 md:hidden">
                  <SidebarTrigger title="Open navigation" />
                  <span className="font-serif text-base italic">Pi Studio</span>
                </header>
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
              </main>
            </SidebarProvider>
          </QueryProvider>
        </TooltipProvider>
        <ToastHost />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
