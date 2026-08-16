'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { flowByKey } from '@/lib/flows'
import { yuan } from '@/lib/finance'
import { DEMO_TODAY, WEEKDAY_LABEL } from '@/lib/seed'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LinkButton } from '@/components/link-button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FlowProgress, PageIntro, StatCard, StatusBadge } from '@/components/blocks'

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
    { label: '现金本金余额', value: yuan(me.cashBalance), hint: '可退可消费' },
    { label: '赠送余额', value: yuan(me.giftBalance), hint: '不可提现' },
    { label: '羽球币', value: me.coins, hint: '激励权益兑换' },
    { label: '成人赛事积分', value: me.eventPoints, hint: '仅排名与晋级' },
    { label: '青少年成长积分', value: me.growthPoints, hint: '仅成长评估' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title={`${me.name}，欢迎回到延庆羽毛球馆`}
        desc="会员端聚合场地预约、赛事报名、培训消课、球局拼场与联盟权益。五类账户独立记账，互不冲抵。"
        rules={['FR-05 五类账户严格分离', 'FR-06 推荐奖励仅一层', 'FR-01 订单绑定四要素']}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">切换演示会员</span>
          <Select value={me.id} onValueChange={(v) => v && setCurrentMember(v)}>
            <SelectTrigger className="w-44" size="sm">
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
        </div>
      </PageIntro>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden bg-sidebar text-sidebar-foreground lg:col-span-2">
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/50">会员卡</span>
                <span className="text-2xl font-semibold leading-tight">{me.name}</span>
                <span className="font-mono text-xs text-sidebar-foreground/55">
                  {me.id} · {me.phone}
                </span>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-full bg-sidebar-primary px-3 py-1 text-xs font-semibold text-sidebar-primary-foreground">
                  {me.level}
                </span>
                <span className="font-mono text-[11px] text-sidebar-foreground/50">有效期至 {me.expiresAt}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {me.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-sm border border-sidebar-border px-2 py-0.5 text-[11px] text-sidebar-foreground/70"
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-sidebar-border pt-4 sm:grid-cols-5">
              {accounts.map((a) => (
                <div key={a.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-lg font-semibold text-sidebar-primary">{a.value}</span>
                  <span className="text-[10px] leading-tight text-sidebar-foreground/60">{a.label}</span>
                  <span className="text-[10px] leading-tight text-sidebar-foreground/35">{a.hint}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton
                href="/member/booking"
                size="sm"
                className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
              >
                立即订场
              </LinkButton>
              <LinkButton
                href="/member/wallet"
                size="sm"
                variant="outline"
                className="border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                账户流水
              </LinkButton>
            </div>
          </CardContent>
        </Card>

        <FlowProgress flow={flowByKey('flow1')} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="近30天到馆" value={me.visits30d} unit="次" hint={`上次到馆 ${me.lastVisitAt ?? '暂无'}`} />
        <StatCard label="我的订单" value={myOrders.length} unit="笔" hint="含场地、赛事、培训与球局" />
        <StatCard label="可用券" value={myCoupons.length} unit="张" tone="gold" hint="体验券与联盟权益券" />
        <StatCard label="在读课包" value={myEnrollments.length} unit="个" tone="brand" hint="培训独立账套" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="gap-1">
            <CardTitle className="text-sm">即将到场</CardTitle>
            <p className="text-xs text-muted-foreground">已支付订单会生成唯一签到码，到场由员工核销。</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {upcoming.length === 0 && (
              <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                暂无待到场订单，去预约一片场地吧
              </div>
            )}
            {upcoming.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{o.title}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {o.date ?? o.createdAt.slice(0, 10)} · {o.id}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={o.status} />
                  <span className="font-mono text-sm font-semibold">{yuan(o.amount)}</span>
                </div>
              </div>
            ))}
            <LinkButton href="/member/orders" variant="ghost" size="sm" className="self-start">
              查看全部订单
              <ArrowRight className="size-3.5" />
            </LinkButton>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-sm">今日推荐</CardTitle>
            <p className="text-xs text-muted-foreground">
              {DEMO_TODAY}（{WEEKDAY_LABEL[DEMO_TODAY]}）
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {openEvent && (
              <Link
                href="/member/events"
                className="flex flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:bg-secondary"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{openEvent.name}</span>
                  <StatusBadge status={openEvent.status} />
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {openEvent.format} · 报名费 {yuan(openEvent.fee)}/人 · 已报 {openEvent.pairs.length}/
                  {openEvent.capacity / 2} 组
                </span>
                <Progress value={(openEvent.pairs.length / (openEvent.capacity / 2)) * 100} className="mt-1" />
              </Link>
            )}
            {games.slice(0, 2).map((g) => (
              <Link
                key={g.id}
                href="/member/games"
                className="flex flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:bg-secondary"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{g.title}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {g.level}
                  </Badge>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {g.date} {g.slot} · {yuan(g.fee)}/人 · {g.joined}/{g.capacity} 人
                </span>
              </Link>
            ))}
            {myCoupons.length > 0 && (
              <Link
                href="/member/coupons"
                className="flex flex-col gap-1 rounded-lg border border-gold/40 bg-gold/10 p-3 transition-colors hover:bg-gold/15"
              >
                <span className="text-xs font-semibold text-gold-foreground">
                  {myCoupons.length} 张券待使用
                </span>
                <span className="text-[11px] text-gold-foreground/75">
                  {couponTemplates.find((t) => t.id === myCoupons[0].templateId)?.name ?? '权益券'} 等
                </span>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
