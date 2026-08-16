'use client'

import Link from 'next/link'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoStore } from '@/lib/store'
import type { FlowDef } from '@/lib/flows'

/** 页面顶部说明：灰底上的紧凑标题区，不再使用卡片 */
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
    <div className="mb-3 flex flex-col gap-2">
      {/* 标题已在顶部导航栏展示，此处仅供屏幕阅读器 */}
      <h2 className="sr-only">{title}</h2>
      <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {rules && rules.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rules.map((r) => (
            <span
              key={r}
              className="rounded-md bg-secondary px-1.5 py-1 text-[10px] leading-none text-secondary-foreground"
            >
              {r}
            </span>
          ))}
        </div>
      )}
      {children}
    </div>
  )
}

/** 数据指标格：白底平铺，无嵌套边框 */
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
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-card px-3 py-2.5">
      <span className="truncate text-[10px] leading-none text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-0.5">
        <span className={cn('font-mono text-lg font-semibold leading-none tracking-tight', toneClass)}>{value}</span>
        {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </span>
      {hint && <span className="truncate text-[10px] leading-tight text-muted-foreground">{hint}</span>}
    </div>
  )
}

/** 内容分区：单层白底容器，标题与内容同层，避免多重卡片嵌套 */
export function SectionCard({
  title,
  description,
  action,
  children,
  flush,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  /** 内容区去掉左右内边距，用于整行列表 */
  flush?: boolean
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-card">
      <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[13px] font-semibold leading-tight tracking-tight text-foreground">{title}</h3>
          {description && (
            <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn('flex flex-col gap-3 pb-3', flush ? 'px-0' : 'px-3')}>{children}</div>
    </section>
  )
}

/** 业务口径说明条 */
export function RuleNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-gold/12 px-3 py-2.5">
      <span className="text-[11px] font-semibold text-gold-foreground">{title}</span>
      <p className="text-pretty text-[11px] leading-relaxed text-foreground/75">{children}</p>
    </div>
  )
}

export function FieldRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={cn('text-right text-[11px] font-medium text-foreground', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

/** 可点击列表行，替代小卡片堆叠 */
export function LinkRow({
  href,
  title,
  desc,
  right,
  icon,
}: {
  href: string
  title: string
  desc?: string
  right?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-3 py-3 active:bg-secondary/60">
      {icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
        {desc && <span className="truncate text-[11px] text-muted-foreground">{desc}</span>}
      </span>
      {right}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </Link>
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
  const tag = 'rounded bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-secondary-foreground'
  return (
    <div className="flex flex-wrap gap-1">
      <span className={tag}>业务 {map[businessType] ?? businessType}</span>
      <span className={tag}>主体 {subject}</span>
      <span className={tag}>支付 {payChannel}</span>
      <span className={tag}>来源 {sourceChannel}</span>
    </div>
  )
}

/** 闭环进度条 */
export function FlowProgress({ flow }: { flow: FlowDef }) {
  const steps = useDemoStore((s) => s.flows[flow.key].steps)
  const done = flow.steps.filter((s) => steps[s.key]).length
  const pct = Math.round((done / flow.steps.length) * 100)
  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-foreground">
          闭环{flow.index} · {flow.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {done}/{flow.steps.length}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-col gap-1.5">
        {flow.steps.map((s, i) => {
          const ok = steps[s.key]
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px]',
                  ok ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground',
                )}
              >
                {ok ? <Check className="size-2.5" /> : i + 1}
              </span>
              <Link
                href={s.href}
                className={cn('truncate text-[11px]', ok ? 'text-foreground' : 'text-muted-foreground')}
              >
                {s.label}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
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
    pending: 'bg-gold/20 text-gold-foreground',
    paid: 'bg-primary/10 text-primary',
    checked_in: 'bg-brand/20 text-brand-foreground',
    completed: 'bg-brand/20 text-brand-foreground',
    refunded: 'bg-destructive/10 text-destructive',
    cancelled: 'bg-secondary text-muted-foreground',
    issued: 'bg-secondary text-muted-foreground',
    claimed: 'bg-primary/10 text-primary',
    redeemed: 'bg-brand/20 text-brand-foreground',
    expired: 'bg-secondary text-muted-foreground',
    报名中: 'bg-primary/10 text-primary',
    进行中: 'bg-gold/20 text-gold-foreground',
    已结束: 'bg-secondary text-muted-foreground',
    在读: 'bg-brand/20 text-brand-foreground',
    已结课: 'bg-secondary text-muted-foreground',
    已退费: 'bg-destructive/10 text-destructive',
    部分退费: 'bg-gold/20 text-gold-foreground',
    待对账: 'bg-gold/20 text-gold-foreground',
    对账中: 'bg-primary/10 text-primary',
    已结算: 'bg-brand/20 text-brand-foreground',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
        tone[status] ?? 'bg-secondary text-muted-foreground',
      )}
    >
      {map[status] ?? status}
    </span>
  )
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-secondary/60 py-8 text-[11px] text-muted-foreground">
      {text}
    </div>
  )
}
