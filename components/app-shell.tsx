'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, RotateCcw, Home } from 'lucide-react'
import { ROLE_NAV, navByRole, roleFromPath } from '@/lib/nav'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const role = roleFromPath(pathname)
  const nav = navByRole(role)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/50">
          切换角色视角
        </span>
        <div className="flex flex-wrap gap-1.5 px-3 pt-1">
          {ROLE_NAV.map((r) => (
            <Link
              key={r.role}
              href={r.home}
              onClick={onNavigate}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                r.role === role
                  ? 'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'border-sidebar-border text-sidebar-foreground/70 hover:border-sidebar-primary/60 hover:text-sidebar-foreground',
              )}
            >
              {r.short}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/50">
          {nav.label}
        </span>
        {nav.items.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg px-3 py-2 transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
            >
              <span className="text-sm font-medium leading-tight">{item.label}</span>
              <span className="text-[11px] leading-tight text-sidebar-foreground/45">{item.desc}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const resetDemo = useDemoStore((s) => s.resetDemo)
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-black text-sidebar-primary-foreground">
          金羽
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">延庆羽毛球馆</span>
          <span className="text-[11px] text-sidebar-foreground/50">会员生态经营系统原型</span>
        </span>
      </Link>

      <ScrollArea className="flex-1">
        <div className="px-2 py-4">
          <NavList onNavigate={onNavigate} />
        </div>
      </ScrollArea>

      <div className="flex flex-col gap-2 border-t border-sidebar-border px-4 py-3">
        <span className="font-mono text-[11px] text-sidebar-foreground/45">演示日期 {DEMO_TODAY}</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 flex-1 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
            nativeButton={false}
            render={<Link href="/" onClick={onNavigate} />}
          >
            <Home className="size-3.5" />
            演示中心
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
            onClick={() => {
              resetDemo()
              toast.success('演示数据已重置为初始状态')
              onNavigate?.()
            }}
          >
            <RotateCcw className="size-3.5" />
            重置
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const role = roleFromPath(pathname)
  const setRole = useDemoStore((s) => s.setRole)
  const nav = navByRole(role)
  const current = nav.items.find((i) => i.href === pathname) ?? nav.items[0]

  useEffect(() => {
    setRole(role)
  }, [role, setRole])

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border lg:block">
        <div className="sticky top-0 h-svh">
          <SidebarInner />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:px-8">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button size="icon" variant="outline" className="lg:hidden" aria-label="打开导航菜单">
                  <Menu className="size-4" />
                </Button>
              }
            />
            <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>导航菜单</SheetTitle>
              </SheetHeader>
              <SidebarInner onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{nav.label}</span>
            <h1 className="truncate text-base font-semibold leading-tight text-foreground">{current.label}</h1>
          </div>

          <span className="ml-auto hidden rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground sm:block">
            原型演示 · 模拟数据
          </span>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
