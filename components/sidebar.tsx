'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  MessageSquare,
  History,
  Package,
  Puzzle,
  Sparkles,
  FileText,
  Plug,
  Cpu,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/', label: 'Agents', icon: Bot },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/sessions', label: 'Sessions', icon: History },
  { href: '/packages', label: 'Packages', icon: Package },
  { href: '/extensions', label: 'Extensions', icon: Puzzle },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/prompts', label: 'Prompts', icon: FileText },
  { href: '/mcp', label: 'MCP', icon: Plug },
  { href: '/models', label: 'Models', icon: Cpu },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ piVersion }: { piVersion: string }) {
  const pathname = usePathname()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-8 items-center justify-center bg-primary text-primary-foreground">
          <svg
            viewBox="0 0 800 800"
            aria-hidden="true"
            focusable="false"
            className="size-6 fill-current"
          >
            <path
              fillRule="evenodd"
              d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
            />
            <path d="M517.36 400H634.72V634.72H517.36Z" />
          </svg>
        </div>
        <div className="leading-none">
          <div className="font-serif text-lg text-foreground italic">Pi Studio</div>
          <div className="font-mono-label text-[9px] text-muted-foreground">control panel</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/' || pathname.startsWith('/agents')
                : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-2.5 border border-transparent px-2.5 py-1.5 font-mono text-[13px] transition-colors',
                    active
                      ? 'border-sidebar-border bg-card text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      active ? 'text-accent' : 'text-muted-foreground',
                    )}
                  />
                  <span className="tracking-wide">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">{piVersion}</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            connected
          </span>
        </div>
      </div>
    </aside>
  )
}
