'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGroup, motion } from 'motion/react'
import {
  Bot,
  CalendarClock,
  Cpu,
  FileKey2,
  FileText,
  History,
  MessageSquare,
  Package,
  Puzzle,
  Settings,
  Sparkles,
} from 'lucide-react'
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

const nav = [
  { href: '/', label: 'Agents', icon: Bot },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/sessions', label: 'Sessions', icon: History },
  { href: '/scheduled-tasks', label: 'Schedule', icon: CalendarClock },
  { href: '/packages', label: 'Packages', icon: Package },
  { href: '/extensions', label: 'Extensions', icon: Puzzle },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/prompts', label: 'Prompts', icon: FileText },
  { href: '/models', label: 'Models', icon: Cpu },
  { href: '/environment', label: 'Environment', icon: FileKey2 },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ piVersion }: { piVersion: string }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="group/header relative block p-0 px-4 py-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:invisible"
          onClick={closeMobileSidebar}
        >
          <PiLogo />
          <span className="min-w-0 leading-none">
            <span className="block truncate font-serif text-lg text-foreground italic">
              Pi Studio
            </span>
            <span className="font-mono-label block truncate text-[9px] text-muted-foreground">
              control panel
            </span>
          </span>
        </Link>
        <SidebarTrigger
          className="absolute top-[18px] right-2 opacity-100 transition-opacity group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:right-2.5 group-data-[collapsible=icon]:opacity-100 md:pointer-events-none md:opacity-0 md:group-hover/header:pointer-events-auto md:group-hover/header:opacity-100"
          title="Toggle sidebar (Ctrl+B)"
        />
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin font-mono">
        <SidebarGroup className="p-0 px-2 py-3">
          <LayoutGroup id="primary-navigation">
            <SidebarMenu className="gap-0.5">
              {nav.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/' || pathname.startsWith('/agents')
                    : pathname.startsWith(item.href)
                const Icon = item.icon

                return (
                  <SidebarMenuItem key={item.href}>
                    {active && (
                      <motion.span
                        layoutId="sidebar-active-item"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 border border-sidebar-border bg-card"
                        transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.75 }}
                      />
                    )}
                    <SidebarMenuButton
                      render={
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          onClick={closeMobileSidebar}
                        />
                      }
                      className="relative data-active:border-transparent data-active:bg-transparent data-active:hover:bg-transparent"
                      isActive={active}
                      variant="studio"
                      size="studio"
                      tooltip={item.label}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </LayoutGroup>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="block p-0 px-4 py-3 font-mono group-data-[collapsible=icon]:px-2">
        <div className="flex items-center justify-between group-data-[collapsible=icon]:hidden">
          <span className="text-[11px] text-muted-foreground">{piVersion}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            connected
          </span>
        </div>
        <span
          className="hidden size-7 items-center justify-center group-data-[collapsible=icon]:flex"
          role="status"
          title={`${piVersion}, connected`}
          aria-label={`${piVersion}, connected`}
        >
          <span className="size-1.5 rounded-full bg-success" />
        </span>
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  )
}

function PiLogo() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center bg-primary text-primary-foreground">
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
    </span>
  )
}
