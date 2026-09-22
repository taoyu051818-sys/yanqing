'use client'

import Link from 'next/link'
import { ArrowRight, Grid3x3, GraduationCap, Receipt, Ticket, Trophy, Users, Wallet } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { flowByKey } from '@/lib/flows'
import { yuan } from '@/lib/finance'
import { DEMO_TODAY, WEEKDAY_LABEL } from '@/lib/seed'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FlowProgress, SectionCard, StatusBadge } from '@/components/blocks'

const QUICK = [
  { href: '/member/booking', label: '预约订场', icon: Grid3x3 },
  { href: '/member/events', label: '赛事报名', icon: Trophy },
  { href: '/member/training', label: '培训课程', icon: GraduationCap },
  { href: '/member/games', label: '球局广场', icon: Users },
  { href: '/member/orders', label: '我的订单', icon: Receipt },
  { href: '/member/coupons', label: '我的券包', icon: Ticket },
  { href: '/member/wallet', label: '账户中心', icon: Wallet },
]

export default function MemberHomePage() {
  const members = useDemoStore((s) => s.members)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const setCurrentMember = useDemoStore((s) => s.setCurrentMember)
  const orders = useDemoStore((s) => s.orders)
  const couponCodes = useDemoStore((s) => s.couponCodes)
  const couponTemplates = useDemoStore((s) => s.couponTemplates)
  const enrollments = useDemoStore((s) => s.enrollments)
  const events = useDemoStore((s) => s.events)
  const games = useDemoStore((s) => s.games)

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]
  const myOrders = orders.filter((o) => o.memberId === me.id)
  const myCoupons = couponCodes.filter((c) => c.memberId === me.id && c.status === 'claimed')
  const myEnrollments = enrollments.filter((e) => e.memberId === me.id)
  const upcoming = myOrders.filter((o) => o.status === 'paid' || o.status === 'checked_in').slice(0, 3)
  const openEvent = events.find((e) => e.status !== '已结束')

  const accounts = [
    { label: '现金本金', value: yuan(me.cashBalance), hint: '可退可消费' },
    { label: '赠送余额', value: yuan(me.giftBalance), hint: '不可提现' },
    { label: '羽球币', value: String(me.coins), hint: '权益兑换' },
    { label: '赛事积分', value: String(me.eventPoints), hint: '仅排名晋级' },
    { label: '成长积分', value: String(me.growthPoints), hint: '仅成长评估' },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* 会员卡头图 */}
      <section className="flex flex-col gap-3 rounded-xl bg-sidebar px-3 py-3 text-sidebar-foreground">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-lg font-semibold leading-tight">{me.name}</span>
            <span className="truncate font-mono text-[10px] text-sidebar-foreground/55">
              {me.id} · {me.phone}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-sidebar-primary px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary-foreground">
              {me.level}
            </span>
            <span className="font-mono text-[10px] text-sidebar-foreground/45">至 {me.expiresAt}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-sidebar-border pt-2.5">
          {accounts.map((a) => (
            <div key={a.label} className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-mono text-sm font-semibold text-sidebar-primary">{a.value}</span>
              <span className="truncate text-[10px] leading-none text-sidebar-foreground/60">{a.label}</span>
              <span className="truncate text-[9px] leading-none text-sidebar-foreground/35">{a.hint}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-sidebar-border pt-2.5">
          <Link
            href="/member/booking"
            className="flex-1 rounded-lg bg-sidebar-primary py-2 text-center text-xs font-semibold text-sidebar-primary-foreground"
          >
            立即订场
          </Link>
          <Link
            href="/member/wallet"
            className="flex-1 rounded-lg bg-sidebar-accent py-2 text-center text-xs font-semibold text-sidebar-accent-foreground"
          >
            账户流水
          </Link>
        </div>
      </section>

      {/* 快捷入口 */}
      <section className="rounded-xl bg-card px-1 py-3">
        <div className="grid grid-cols-4 gap-y-3">
          {QUICK.map((q) => {
            const Icon = q.icon
            return (
              <Link key={q.href} href={q.href} className="flex flex-col items-center gap-1.5 py-0.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand/12 text-brand-foreground">
                  <Icon className="size-[18px]" />
                </span>
                <span className="text-[10px] leading-none text-foreground">{q.label}</span>
              </Link>
            )
          })}
          <div className="flex flex-col items-center gap-1.5 py-0.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gold/15 font-mono text-[11px] font-bold text-gold-foreground">
              {myCoupons.length}
            </span>
            <span className="text-[10px] leading-none text-muted-foreground">可用券</span>
          </div>
        </div>
      </section>

      <FlowProgress flow={flowByKey('flow1')} />

      <SectionCard title="即将到场" description="已支付订单生成唯一签到码，到场由员工核销。" flush>
        {upcoming.length === 0 && (
          <div className="mx-3 rounded-xl bg-secondary/60 py-8 text-center text-[11px] text-muted-foreground">
            暂无待到场订单，去预约一片场地吧
          </div>
        )}
        {upcoming.map((o) => (
          <Link
            key={o.id}
            href="/member/orders"
            className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5 last:border-0 active:bg-secondary/60"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-medium text-foreground">{o.title}</span>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {o.date ?? o.createdAt.slice(0, 10)} · {o.id}
              </span>
            </span>
            <StatusBadge status={o.status} />
            <span className="shrink-0 font-mono text-[13px] font-semibold text-foreground">{yuan(o.amount)}</span>
          </Link>
        ))}
        <Link
          href="/member/orders"
          className="flex items-center justify-center gap-1 px-3 pt-1 text-[11px] font-medium text-primary"
        >
          查看全部订单
          <ArrowRight className="size-3" />
        </Link>
      </SectionCard>

      <SectionCard title="今日推荐" description={`${DEMO_TODAY}（${WEEKDAY_LABEL[DEMO_TODAY]}）`}>
        {openEvent && (
          <Link href="/member/events" className="flex flex-col gap-1.5 rounded-xl bg-secondary/60 p-2.5">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-foreground">{openEvent.name}</span>
              <StatusBadge status={openEvent.status} />
            </span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {openEvent.format} · {yuan(openEvent.fee)}/人 · 已报 {openEvent.pairs.length}/{openEvent.capacity / 2} 组
            </span>
            <Progress value={(openEvent.pairs.length / (openEvent.capacity / 2)) * 100} className="h-1" />
          </Link>
        )}
        {games.slice(0, 2).map((g) => (
          <Link key={g.id} href="/member/games" className="flex flex-col gap-1 rounded-xl bg-secondary/60 p-2.5">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-foreground">{g.title}</span>
              <span className="shrink-0 rounded bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {g.level}
              </span>
            </span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {g.date} {g.slot} · {yuan(g.fee)}/人 · {g.joined}/{g.capacity} 人
            </span>
          </Link>
        ))}
        {myCoupons.length > 0 && (
          <Link href="/member/coupons" className="flex flex-col gap-0.5 rounded-xl bg-gold/12 p-2.5">
            <span className="text-xs font-semibold text-gold-foreground">{myCoupons.length} 张券待使用</span>
            <span className="text-[10px] text-gold-foreground/75">
              {couponTemplates.find((t) => t.id === myCoupons[0].templateId)?.name ?? '权益券'} 等
            </span>
          </Link>
        )}
      </SectionCard>

      <SectionCard title="演示设置" description="切换演示会员，观察不同标签会员的权益差异。">
        <Select value={me.id} onValueChange={(v) => v && setCurrentMember(v)}>
          <SelectTrigger className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} · {m.level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1">
          {['FR-05 五类账户严格分离', 'FR-06 推荐奖励仅一层', 'FR-01 订单绑定四要素'].map((r) => (
            <span key={r} className="rounded bg-secondary px-1.5 py-1 text-[10px] leading-none text-muted-foreground">
              {r}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1">
          <span className="flex flex-col gap-0.5 rounded-xl bg-secondary/60 px-2 py-2">
            <span className="font-mono text-sm font-semibold text-foreground">{me.visits30d}</span>
            <span className="text-[10px] leading-none text-muted-foreground">近30天到馆</span>
          </span>
          <span className="flex flex-col gap-0.5 rounded-xl bg-secondary/60 px-2 py-2">
            <span className="font-mono text-sm font-semibold text-foreground">{myOrders.length}</span>
            <span className="text-[10px] leading-none text-muted-foreground">我的订单</span>
          </span>
          <span className="flex flex-col gap-0.5 rounded-xl bg-secondary/60 px-2 py-2">
            <span className="font-mono text-sm font-semibold text-brand-foreground">{myEnrollments.length}</span>
            <span className="text-[10px] leading-none text-muted-foreground">在读课包</span>
          </span>
        </div>
      </SectionCard>
    </div>
  )
}
