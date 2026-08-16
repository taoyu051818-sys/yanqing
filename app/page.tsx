'use client'

import Link from 'next/link'
import { ArrowRight, ChevronRight, RotateCcw } from 'lucide-react'
import { FLOWS, ROLE_LABEL } from '@/lib/flows'
import { ROLE_ICON, ROLE_NAV } from '@/lib/nav'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const HIGHLIGHTS = [
  { k: '20', label: '片场地可视化排程' },
  { k: '5', label: '轮瑞士积分赛编排' },
  { k: '20%', label: '培训流水计入合同' },
  { k: '0', label: '培训另付场地费' },
]

const NOTES = [
  {
    title: '财务口径',
    items: ['培训独立账套，预收与确认收入分离', '有效流水 × 20% 计入球馆合同流水', '培训占场只做效率分析，不产生场地费'],
  },
  {
    title: '风控与留痕',
    items: ['券码唯一，重复核销即时拦截', '比分修正、账户调整写入审计日志', '推荐奖励仅一层，过观察期后发放'],
  },
]

export default function DemoCenterPage() {
  const flows = useDemoStore((s) => s.flows)
  const resetDemo = useDemoStore((s) => s.resetDemo)
  const orders = useDemoStore((s) => s.orders)
  const members = useDemoStore((s) => s.members)

  const totalSteps = FLOWS.reduce((a, f) => a + f.steps.length, 0)
  const doneSteps = FLOWS.reduce((a, f) => a + f.steps.filter((s) => flows[f.key].steps[s.key]).length, 0)

  return (
    <div className="flex min-h-svh justify-center bg-muted">
      <div className="flex w-full max-w-[430px] flex-col border-border bg-muted sm:border-x">
        {/* 顶部品牌区 */}
        <header className="flex flex-col gap-4 bg-sidebar px-4 pb-5 pt-6 text-sidebar-foreground">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-[11px] font-black text-sidebar-primary-foreground">
              金羽
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px] font-semibold">延庆羽毛球馆 · 会员生态系统</span>
              <span className="truncate font-mono text-[10px] text-sidebar-foreground/50">
                高保真原型 · {DEMO_TODAY}
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-balance text-xl font-bold leading-snug tracking-tight">
              以 20 片场地为底座，把订场、赛事、培训、球局与异业联盟串成一套可对账的会员生态
            </h1>
            <p className="text-pretty text-[11px] leading-relaxed text-sidebar-foreground/60">
              覆盖需求书四条核心闭环与四端角色。订单绑定业务类型、收款主体、支付渠道与来源渠道；培训独立建账并按 20%
              有效流水计入合同口径；五类账户严格分离。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-sidebar-border pt-3.5">
            {HIGHLIGHTS.map((h) => (
              <div key={h.label} className="flex flex-col gap-0.5">
                <span className="font-mono text-lg font-semibold leading-none text-sidebar-primary">{h.k}</span>
                <span className="text-[10px] leading-tight text-sidebar-foreground/55">{h.label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Link
              href="/member/coupons"
              className="flex items-center justify-center gap-1.5 rounded-xl bg-sidebar-primary py-2.5 text-[13px] font-semibold text-sidebar-primary-foreground"
            >
              从闭环一开始体验
              <ArrowRight className="size-4" />
            </Link>
            <button
              type="button"
              onClick={() => {
                resetDemo()
                toast.success('演示数据已重置')
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-sidebar-accent py-2.5 text-[13px] font-semibold text-sidebar-accent-foreground"
            >
              <RotateCcw className="size-3.5" />
              重置演示数据
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-3 px-3 py-3">
          {/* 闭环总进度 */}
          <section className="flex flex-col gap-2 rounded-xl bg-card px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">四条演示闭环</h2>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {doneSteps}/{totalSteps}
              </span>
            </div>
            <Progress value={(doneSteps / totalSteps) * 100} className="h-1" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              按顺序点击每一步即可跨端完成闭环，进度实时记录。
            </p>
          </section>

          {/* 各闭环 */}
          {FLOWS.map((flow) => {
            const steps = flows[flow.key].steps
            const done = flow.steps.filter((s) => steps[s.key]).length
            return (
              <section key={flow.key} className="flex flex-col gap-2.5 rounded-xl bg-card px-3 py-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-[10px] text-primary-foreground">
                    {flow.index}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-semibold text-foreground">{flow.title}</span>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">{flow.subtitle}</span>
                  </span>
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground">
                    {done}/{flow.steps.length}
                  </span>
                </div>

                <ol className="flex flex-col">
                  {flow.steps.map((s, i) => {
                    const ok = steps[s.key]
                    return (
                      <li key={s.key}>
                        <Link href={s.href} className="flex items-center gap-2 rounded-lg py-1.5 active:bg-secondary/60">
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px]',
                              ok ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground',
                            )}
                          >
                            {i + 1}
                          </span>
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-[11px]',
                              ok ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {s.label}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">{ROLE_LABEL[s.role]}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ol>

                <div className="flex flex-col gap-1 rounded-xl bg-secondary/60 p-2.5">
                  {flow.rules.map((r) => (
                    <span key={r} className="text-[10px] leading-relaxed text-secondary-foreground/80">
                      · {r}
                    </span>
                  ))}
                </div>

                <Link
                  href={flow.entry}
                  className="flex items-center justify-center gap-1 rounded-xl bg-brand/12 py-2 text-[12px] font-semibold text-brand-foreground"
                >
                  进入闭环入口
                  <ArrowRight className="size-3.5" />
                </Link>
              </section>
            )
          })}

          {/* 四端入口 */}
          <section className="overflow-hidden rounded-xl bg-card">
            <div className="flex flex-col gap-0.5 px-3 pb-2 pt-3">
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">四端角色视角</h2>
              <p className="text-[11px] text-muted-foreground">底部“更多”可随时切换角色，数据实时联动。</p>
            </div>
            {ROLE_NAV.map((r) => {
              const Icon = ROLE_ICON[r.role]
              return (
                <Link
                  key={r.role}
                  href={r.home}
                  className="flex items-center gap-3 border-b border-border/60 px-3 py-3 last:border-0 active:bg-secondary/60"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium text-foreground">{r.label}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {r.items.length} 个功能页 · {r.items.slice(0, 3).map((i) => i.label).join(' / ')}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                </Link>
              )
            })}
          </section>

          {/* 口径说明 */}
          <section className="flex flex-col gap-2 rounded-xl bg-card px-3 py-3">
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">预置数据规模</h2>
            <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
              <span>会员档案 {members.length} 人（体验 / 普通 / 金羽 / 黑羽）</span>
              <span>历史订单 {orders.length} 笔，覆盖五类业务</span>
              <span>20 片场地 × 6 个时段排程矩阵</span>
            </div>
          </section>

          {NOTES.map((n) => (
            <section key={n.title} className="flex flex-col gap-2 rounded-xl bg-card px-3 py-3">
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{n.title}</h2>
              <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
                {n.items.map((i) => (
                  <span key={i}>· {i}</span>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
