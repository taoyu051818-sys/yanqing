'use client'

import { useMemo } from 'react'
import { ArrowRight, QrCode, Trophy, GraduationCap, LayoutGrid } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, StatCard, SectionCard, StatusBadge, EmptyHint } from '@/components/blocks'
import { LinkButton } from '@/components/link-button'
import { Badge } from '@/components/ui/badge'
import { DEMO_TODAY } from '@/lib/seed'

const QUICK = [
  { href: '/staff/checkin', label: '订场核销', desc: '扫码签到放行', icon: QrCode },
  { href: '/staff/event', label: '赛事控制台', desc: '签到编排录分', icon: Trophy },
  { href: '/staff/training', label: '教练消课', desc: '课时签到确认', icon: GraduationCap },
  { href: '/staff/courts', label: '场地看板', desc: '20片实时状态', icon: LayoutGrid },
]

export default function StaffHomePage() {
  const orders = useDemoStore((s) => s.orders)
  const courts = useDemoStore((s) => s.courts)
  const slots = useDemoStore((s) => s.slots)
  const events = useDemoStore((s) => s.events)
  const enrollments = useDemoStore((s) => s.enrollments)

  const todayVenue = useMemo(
    () => orders.filter((o) => o.businessType === 'venue' && o.date === DEMO_TODAY),
    [orders],
  )
  const waiting = todayVenue.filter((o) => o.status === 'paid')
  const checked = todayVenue.filter((o) => o.status === 'checked_in' || o.status === 'completed')
  const occupied = new Set(todayVenue.filter((o) => o.status !== 'refunded').map((o) => o.courtId))
  const utilization = Math.round((todayVenue.length / (courts.length * slots.length)) * 100)
  const runningEvent = events.find((e) => e.status !== '已结束') ?? events[0]
  const pendingSessions = enrollments.filter((e) => e.totalSessions - e.usedSessions > 0).length

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="值班工作台"
        desc={`今日 ${DEMO_TODAY} 的核销任务、场地占用与赛事培训待办，一屏掌握。所有操作都会写入订单流水与审计日志。`}
        rules={['核销即改变订单状态', '操作人留痕', '不可重复核销']}
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard label="待核销订单" value={waiting.length} unit="单" hint="已支付未到场" tone="gold" />
        <StatCard label="已核销入场" value={checked.length} unit="单" hint="含已完成订单" tone="brand" />
        <StatCard label="今日占用场地" value={`${occupied.size}/${courts.length}`} hint={`时段利用率 ${utilization}%`} />
        <StatCard label="待消课时" value={pendingSessions} unit="人" hint="学员剩余课时>0" tone="primary" />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {QUICK.map((q) => (
          <SectionCard key={q.href} title={q.label} description={q.desc}>
            <div className="flex items-center justify-between gap-2">
              <q.icon className="size-5 text-muted-foreground" aria-hidden />
              <LinkButton href={q.href} size="sm" variant="outline">
                进入
                <ArrowRight className="size-3.5" />
              </LinkButton>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard
        title="今日待核销队列"
        description="按下单时间排序，核销后订单状态从「已支付」变为「已签到」，同时记录操作人。"
        action={
          <LinkButton href="/staff/checkin" size="sm">
            前往核销
            <ArrowRight className="size-3.5" />
          </LinkButton>
        }
      >
        {waiting.length === 0 ? (
          <EmptyHint text="今日暂无待核销订单" />
        ) : (
          <ul className="flex flex-col gap-2">
            {waiting.map((o) => {
              const court = courts.find((c) => c.id === o.courtId)
              const slot = slots.find((s) => s.id === o.slotId)
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {o.memberName} · {court?.name} · {slot?.label}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {o.id} · 签到码 {o.qrCode} · ¥{o.amount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {o.sourceChannel}
                    </Badge>
                    <StatusBadge status={o.status} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {runningEvent && (
        <SectionCard
          title={`赛事进行中：${runningEvent.name}`}
          description={`当前第 ${runningEvent.currentRound} / ${runningEvent.totalRounds} 轮，${runningEvent.pairs.length} 组参赛，瑞士制自动避免重复对手。`}
          action={
            <LinkButton href="/staff/event" size="sm" variant="outline">
              打开控制台
              <ArrowRight className="size-3.5" />
            </LinkButton>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatCard label="已签到组合" value={runningEvent.pairs.filter((p) => p.checkedIn).length} unit="组" />
            <StatCard label="待录入比分" value={runningEvent.matches.filter((m) => !m.confirmed).length} unit="场" />
            <StatCard label="赛事状态" value={runningEvent.status} />
          </div>
        </SectionCard>
      )}
    </div>
  )
}
