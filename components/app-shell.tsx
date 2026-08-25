'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronLeft, MoreHorizontal, RotateCcw } from 'lucide-react'
import { ROLE_ICON, ROLE_NAV, navByRole, roleFromPath, tabsByRole } from '@/lib/nav'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { GuideProvider } from '@/components/guide'
import { DemoDirector } from '@/components/demo-director'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** 底部标签栏：每个角色 4 个主入口 + 更多 */
function TabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname()
  const role = roleFromPath(pathname)
  const tabs = tabsByRole(role)

  return (
    <nav
      aria-label="主导航"
      className="sticky bottom-0 z-30 flex items-stretch border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      {tabs.map((t) => {
        const active = pathname === t.href
        const Icon = t.icon
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors',
              active ? 'text-brand-foreground' : 'text-muted-foreground',
            )}
          >
            <Icon className={cn('size-[18px]', active && 'text-brand-foreground')} strokeWidth={active ? 2.4 : 1.8} />
            <span className={cn('text-[10px] leading-none', active && 'font-semibold')}>{t.tabLabel}</span>
          </Link>
        )
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground"
      >
        <MoreHorizontal className="size-[18px]" strokeWidth={1.8} />
        <span className="text-[10px] leading-none">更多</span>
      </button>
    </nav>
  )
}

/** 更多面板：角色切换 + 该角色全部页面 + 演示控制 */
function MorePanel({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname()
  const role = roleFromPath(pathname)
  const nav = navByRole(role)
  const resetDemo = useDemoStore((s) => s.resetDemo)

  return (
    <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-8 pt-2">
      <section className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">切换角色视角</span>
        <div className="grid grid-cols-2 gap-2">
          {ROLE_NAV.map((r) => {
            const Icon = ROLE_ICON[r.role]
            const active = r.role === role
            return (
              <Link
                key={r.role}
                href={r.home}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-brand text-brand-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{r.short}端</span>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{nav.label}全部功能</span>
        <div className="overflow-hidden rounded-xl bg-card">
          {nav.items.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className="flex items-center gap-3 border-b border-border/60 px-3 py-3 last:border-0 active:bg-secondary/60"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                    active ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn('truncate text-sm', active ? 'font-semibold text-foreground' : 'text-foreground')}>
                    {item.label}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{item.desc}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            resetDemo()
            toast.success('演示数据已重置为初始状态')
            onNavigate()
          }}
          className="flex items-center justify-center gap-2 rounded-xl bg-secondary py-3 text-xs font-medium text-secondary-foreground active:bg-secondary/70"
        >
          <RotateCcw className="size-3.5" />
          重置演示数据
        </button>
        <p className="text-center font-mono text-[10px] text-muted-foreground">演示日期 {DEMO_TODAY} · 模拟数据</p>
      </section>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [more, setMore] = useState(false)
  const role = roleFromPath(pathname)
  const setRole = useDemoStore((s) => s.setRole)
  const nav = navByRole(role)
  const current = nav.items.find((i) => i.href === pathname) ?? nav.items[0]
  const isRoleHome = pathname === nav.home

  useEffect(() => {
    setRole(role)
  }, [role, setRole])

  return (
    <div className="flex min-h-svh justify-center bg-muted">
      <div className="flex min-h-svh w-full max-w-[430px] flex-col border-border bg-background sm:border-x">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2.5 backdrop-blur">
          {isRoleHome ? (
            <Link
              href="/"
              aria-label="返回演示中心"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-[11px] font-black text-brand-foreground"
            >
              金羽
            </Link>
          ) : (
            <Link
              href={nav.home}
              aria-label="返回上一级"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-secondary"
            >
              <ChevronLeft className="size-5" />
            </Link>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground">{current.label}</h1>
            <span className="truncate text-[10px] leading-tight text-muted-foreground">{nav.label}</span>
          </div>

          <Link
            href="/"
            className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium text-secondary-foreground"
          >
            {nav.short}端
          </Link>
        </header>

        <GuideProvider>
          <main className="flex-1 bg-muted px-3 pb-16 pt-3">{children}</main>
          <DemoDirector />
        </GuideProvider>

        <TabBar onMore={() => setMore(true)} />

        <Sheet open={more} onOpenChange={setMore}>
          <SheetContent side="bottom" className="max-h-[86svh] rounded-t-2xl bg-muted p-0">
            <SheetHeader className="px-4 pb-1 pt-4">
              <SheetTitle className="text-sm">全部功能与角色切换</SheetTitle>
            </SheetHeader>
            <MorePanel onNavigate={() => setMore(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
