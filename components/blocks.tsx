'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useDemoStore } from '@/lib/store'
import type { FlowDef } from '@/lib/flows'

export function PageIntro({
  title,
  desc,
  rules,
  children,
}: {
  title: string
  desc: string
  rules?: string[]
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground">{desc}</p>
        </div>
        {children}
      </div>
      {rules && rules.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rules.map((r) => (
            <span
              key={r}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] leading-none text-muted-foreground"
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  unit?: string
  hint?: string
  tone?: 'default' | 'brand' | 'gold' | 'primary'
}) {
  const toneClass = {
    default: 'text-foreground',
    brand: 'text-brand-foreground',
    gold: 'text-gold-foreground',
    primary: 'text-primary',
  }[tone]
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className="flex items-baseline gap-1">
          <span className={cn('font-mono text-2xl font-semibold leading-none', toneClass)}>{value}</span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </span>
        {hint && <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  )
}

/** 带标题与说明的内容分区容器 */
export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
            {description && (
              <p className="max-w-2xl text-pretty text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** 业务口径说明条，用于标注需求书中的强规则 */
export function RuleNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3">
      <span className="text-xs font-semibold text-gold-foreground">{title}</span>
      <p className="text-pretty text-xs leading-relaxed text-foreground/80">{children}</p>
    </div>
  )
}

export function FieldRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-right text-xs font-medium text-foreground', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

/** 订单四要素标签（FR-01） */
export function FourFactorTags({
  businessType,
  subject,
  payChannel,
  sourceChannel,
}: {
  businessType: string
  subject: string
  payChannel: string
  sourceChannel: string
}) {
  const map: Record<string, string> = {
    venue: '场地',
    event: '赛事',
    training: '培训',
    game: '球局',
    goods: '商品',
  }
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="secondary" className="rounded-sm text-[10px]">
        业务 {map[businessType] ?? businessType}
      </Badge>
      <Badge variant="outline" className="rounded-sm text-[10px]">
        主体 {subject}
      </Badge>
      <Badge variant="outline" className="rounded-sm text-[10px]">
        支付 {payChannel}
      </Badge>
      <Badge variant="outline" className="rounded-sm text-[10px]">
        来源 {sourceChannel}
      </Badge>
    </div>
  )
}

/** 闭环进度条：显示当前闭环各步骤完成情况 */
export function FlowProgress({ flow }: { flow: FlowDef }) {
  const steps = useDemoStore((s) => s.flows[flow.key].steps)
  const done = flow.steps.filter((s) => steps[s.key]).length
  return (
    <Card className="gap-0 border-primary/20 bg-primary/[0.03] py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">
            闭环{flow.index}· {flow.title}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {done}/{flow.steps.length}
          </span>
        </div>
        <ol className="flex flex-col gap-1.5">
          {flow.steps.map((s, i) => {
            const ok = steps[s.key]
            return (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px]',
                    ok ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {ok ? <Check className="size-2.5" /> : i + 1}
                </span>
                <Link
                  href={s.href}
                  className={cn(
                    'truncate text-xs hover:underline',
                    ok ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </Link>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: '待支付',
    paid: '已支付',
    checked_in: '已签到',
    completed: '已完成',
    refunded: '已退款',
    cancelled: '已取消',
    issued: '未领取',
    claimed: '已领取',
    redeemed: '已核销',
    expired: '已过期',
  }
  const tone: Record<string, string> = {
    pending: 'bg-gold/20 text-gold-foreground border-gold/40',
    paid: 'bg-primary/10 text-primary border-primary/25',
    checked_in: 'bg-brand/20 text-brand-foreground border-brand/40',
    completed: 'bg-brand/20 text-brand-foreground border-brand/40',
    refunded: 'bg-destructive/10 text-destructive border-destructive/25',
    cancelled: 'bg-muted text-muted-foreground border-border',
    issued: 'bg-muted text-muted-foreground border-border',
    claimed: 'bg-primary/10 text-primary border-primary/25',
    redeemed: 'bg-brand/20 text-brand-foreground border-brand/40',
    expired: 'bg-muted text-muted-foreground border-border',
    报名中: 'bg-primary/10 text-primary border-primary/25',
    进行中: 'bg-gold/20 text-gold-foreground border-gold/40',
    已结束: 'bg-muted text-muted-foreground border-border',
    在读: 'bg-brand/20 text-brand-foreground border-brand/40',
    已结课: 'bg-muted text-muted-foreground border-border',
    已退费: 'bg-destructive/10 text-destructive border-destructive/25',
    部分退费: 'bg-gold/20 text-gold-foreground border-gold/40',
    待对账: 'bg-gold/20 text-gold-foreground border-gold/40',
    对账中: 'bg-primary/10 text-primary border-primary/25',
    已结算: 'bg-brand/20 text-brand-foreground border-brand/40',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        tone[status] ?? 'bg-muted text-muted-foreground border-border',
      )}
    >
      {map[status] ?? status}
    </span>
  )
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-10 text-xs text-muted-foreground">
      {text}
    </div>
  )
}
