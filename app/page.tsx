'use client'

import Link from 'next/link'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { FLOWS, ROLE_LABEL } from '@/lib/flows'
import { ROLE_NAV } from '@/lib/nav'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/link-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const HIGHLIGHTS = [
  { k: '20', label: '片场地可视化排程' },
  { k: '5', label: '轮瑞士积分赛编排' },
  { k: '20%', label: '培训流水计入球馆合同' },
  { k: '0', label: '培训另付场地费' },
]

export default function DemoCenterPage() {
  const flows = useDemoStore((s) => s.flows)
  const resetDemo = useDemoStore((s) => s.resetDemo)
  const orders = useDemoStore((s) => s.orders)
  const members = useDemoStore((s) => s.members)

  const totalSteps = FLOWS.reduce((a, f) => a + f.steps.length, 0)
  const doneSteps = FLOWS.reduce((a, f) => a + f.steps.filter((s) => flows[f.key].steps[s.key]).length, 0)

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 lg:px-8 lg:py-16">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-black text-sidebar-primary-foreground">
              金羽
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">延庆羽毛球馆 · 会员生态经营与小程序系统</span>
              <span className="font-mono text-[11px] text-sidebar-foreground/50">
                高保真交互原型 · 演示日期 {DEMO_TODAY}
              </span>
            </div>
          </div>

          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight lg:text-4xl">
              以 20 片场地为底座，把订场、赛事、培训、球局与异业联盟串成一套可对账的会员生态
            </h1>
            <p className="text-pretty text-sm leading-relaxed text-sidebar-foreground/65 lg:text-base">
              本原型覆盖需求书中的四条核心闭环与四端角色视角。所有订单绑定业务类型、收款主体、支付渠道与来源渠道；培训独立建账并按
              20% 有效流水计入球馆合同口径；五类账户严格分离，不可互相冲抵。
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton
                href="/member/coupons"
                size="lg"
                className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
              >
                从闭环一开始体验
                <ArrowRight className="size-4" />
              </LinkButton>
              <Button
                size="lg"
                variant="outline"
                className="border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => {
                  resetDemo()
                  toast.success('演示数据已重置')
                }}
              >
                <RotateCcw className="size-4" />
                重置演示数据
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-sidebar-border pt-6 lg:grid-cols-4">
            {HIGHLIGHTS.map((h) => (
              <div key={h.label} className="flex flex-col gap-1">
                <span className="font-mono text-2xl font-semibold text-sidebar-primary">{h.k}</span>
                <span className="text-[11px] leading-tight text-sidebar-foreground/55">{h.label}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-10 lg:px-8 lg:py-14">
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">四条演示闭环</h2>
              <p className="text-sm text-muted-foreground">按顺序点击每一步即可跨端完成闭环，进度会实时记录。</p>
            </div>
            <div className="flex items-center gap-3">
              <Progress value={(doneSteps / totalSteps) * 100} className="w-32" />
              <span className="font-mono text-xs text-muted-foreground">
                {doneSteps}/{totalSteps}
              </span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {FLOWS.map((flow) => {
              const steps = flows[flow.key].steps
              const done = flow.steps.filter((s) => steps[s.key]).length
              return (
                <Card key={flow.key} className="gap-4">
                  <CardHeader className="gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex size-6 items-center justify-center rounded-md bg-primary font-mono text-[11px] text-primary-foreground">
                          {flow.index}
                        </span>
                        {flow.title}
                      </CardTitle>
                      <Badge
                        variant={done === flow.steps.length ? 'default' : 'secondary'}
                        className="font-mono text-[10px]"
                      >
                        {done}/{flow.steps.length}
                      </Badge>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{flow.subtitle}</p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <ol className="flex flex-col gap-1">
                      {flow.steps.map((s, i) => {
                        const ok = steps[s.key]
                        return (
                          <li key={s.key}>
                            <Link
                              href={s.href}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary"
                            >
                              <span
                                className={cn(
                                  'flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px]',
                                  ok ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {i + 1}
                              </span>
                              <span className={cn('flex-1 text-xs', ok ? 'text-foreground' : 'text-muted-foreground')}>
                                {s.label}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">{ROLE_LABEL[s.role]}</span>
                            </Link>
                          </li>
                        )
                      })}
                    </ol>
                    <div className="flex flex-col gap-1 rounded-lg bg-secondary/60 p-3">
                      {flow.rules.map((r) => (
                        <span key={r} className="text-[11px] leading-relaxed text-secondary-foreground/80">
                          · {r}
                        </span>
                      ))}
                    </div>
                    <LinkButton href={flow.entry} variant="outline" size="sm" className="self-start">
                      进入闭环入口
                      <ArrowRight className="size-3.5" />
                    </LinkButton>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">四端角色视角</h2>
            <p className="text-sm text-muted-foreground">左侧导航可随时切换角色，数据在四端之间实时联动。</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {ROLE_NAV.map((r) => (
              <Card key={r.role} className="gap-3">
                <CardHeader className="gap-1">
                  <CardTitle className="text-sm">{r.label}</CardTitle>
                  <p className="text-[11px] text-muted-foreground">{r.items.length} 个功能页面</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-1">
                    {r.items.slice(0, 5).map((i) => (
                      <li key={i.href} className="text-[11px] leading-tight text-muted-foreground">
                        · {i.label}
                      </li>
                    ))}
                  </ul>
                  <LinkButton href={r.home} size="sm" variant="secondary" className="mt-1 self-start">
                    进入{r.short}端
                  </LinkButton>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card className="gap-2">
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">预置数据规模</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>会员档案 {members.length} 人（含体验、普通、金羽、黑羽）</span>
              <span>历史订单 {orders.length} 笔，覆盖五类业务</span>
              <span>20 片场地 × 6 个时段的排程矩阵</span>
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">财务口径</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>培训独立账套，预收与确认收入分离</span>
              <span>有效流水 × 20% 计入球馆合同流水</span>
              <span>培训占场只做效率分析，不产生场地费</span>
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">风控与留痕</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>券码唯一，重复核销即时拦截</span>
              <span>比分修正、账户调整全部写入审计日志</span>
              <span>推荐奖励仅一层，过观察期后发放</span>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
