'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Trophy, Users, Medal } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, FieldRow, FlowProgress, EmptyHint, RuleNote } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { LinkButton } from '@/components/link-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { rankPairs, pairName } from '@/lib/swiss'
import type { PayChannel } from '@/lib/types'

const CHANNELS: PayChannel[] = ['微信支付', '现金余额', '赠送余额', '羽球币']

export default function MemberEventsPage() {
  const events = useDemoStore((s) => s.events)
  const members = useDemoStore((s) => s.members)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const eventHistory = useDemoStore((s) => s.eventHistory)
  const registerEventPair = useDemoStore((s) => s.registerEventPair)

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]
  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [partner, setPartner] = useState('')
  const [payChannel, setPayChannel] = useState<PayChannel>('微信支付')

  const event = events.find((e) => e.id === eventId) ?? events[0]
  const myHistory = useMemo(() => eventHistory.filter((h) => h.memberId === me.id), [eventHistory, me.id])
  const ranked = useMemo(() => (event ? rankPairs(event.pairs) : []), [event])
  const myPair = event?.pairs.find((p) => p.memberIds.includes(me.id))
  const leaderboard = useMemo(
    () => [...members].sort((a, b) => b.eventPoints - a.eventPoints).slice(0, 8),
    [members],
  )

  const handleRegister = () => {
    if (!event) return
    if (!partner.trim()) {
      toast.error('请填写搭档姓名，赛事以双人组合为报名单位')
      return
    }
    const res = registerEventPair({
      eventId: event.id,
      playerA: me.name,
      playerB: partner.trim(),
      memberIds: [me.id],
      payChannel,
    })
    if (res.ok) {
      toast.success(res.message)
      setPartner('')
    } else {
      toast.error(res.message)
    }
  }

  if (!event) return <EmptyHint text="暂无赛事" />

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="赛事报名 · 5轮瑞士积分制"
        desc="以双人组合为报名单位，缴费成功即锁定名额。瑞士制每轮按积分接近原则配对，同一组合不重复相遇，奇数组自动轮空计1分。"
        rules={['双人组合报名', '同分区配对', '不重复对手', '轮空计1分']}
      />

      <FlowProgress flow={FLOWS[1]} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title={event.name}
          description={`${event.date} · ${event.venue} · ${event.format} · 赞助方 ${event.sponsor}`}
          action={<Badge variant="outline">{event.status}</Badge>}
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard label="报名费" value={event.fee} unit="元/组" tone="primary" />
              <StatCard label="已报名" value={`${event.pairs.length}/${event.capacity}`} unit="组" tone="brand" />
              <StatCard label="总轮次" value={event.totalRounds} unit="轮" />
              <StatCard label="当前轮次" value={event.currentRound} unit="轮" tone="gold" />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-4">
              <span className="text-xs font-semibold text-foreground">赛事规则</span>
              <ul className="flex flex-col gap-1">
                {event.rules.map((r) => (
                  <li key={r} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                    <span className="text-brand-foreground" aria-hidden>
                      ·
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold">当前报名组合与积分</span>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">排名</TableHead>
                      <TableHead>组合</TableHead>
                      <TableHead className="text-right">积分</TableHead>
                      <TableHead className="text-right">胜/负</TableHead>
                      <TableHead className="text-right">净胜分</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((p, i) => (
                      <TableRow key={p.id} className={p.memberIds.includes(me.id) ? 'bg-brand/10' : undefined}>
                        <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                        <TableCell className="text-sm">
                          {pairName(p)}
                          {p.memberIds.includes(me.id) && (
                            <Badge variant="outline" className="ml-2 border-brand/40 text-[10px] text-brand-foreground">
                              我的组合
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium tabular-nums">
                          {p.points}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {p.wins}/{p.losses}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {p.scoreDiff > 0 ? '+' : ''}
                          {p.scoreDiff}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {p.checkedIn ? '已签到' : p.paid ? '已缴费' : '待缴费'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title="报名我的组合" description="填写搭档姓名并选择支付方式，缴费成功即写入参赛名单。">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ev">选择赛事</Label>
                <Select value={eventId} onValueChange={(v) => v && setEventId(v)}>
                  <SelectTrigger id="ev">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}（{e.status}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>主选手</Label>
                <Input value={me.name} readOnly className="bg-muted" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner">搭档姓名</Label>
                <Input
                  id="partner"
                  value={partner}
                  placeholder="如 王岩"
                  onChange={(e) => setPartner(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleRegister()
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pc">支付方式</Label>
                <Select value={payChannel} onValueChange={(v) => v && setPayChannel(v as PayChannel)}>
                  <SelectTrigger id="pc">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <FieldRow label="报名费" value={`¥${event.fee} / 组`} mono />
                <FieldRow label="业务类型" value="赛事（event）" />
                <FieldRow label="收款主体" value="球馆本部" />
              </div>
              <Button onClick={handleRegister} disabled={Boolean(myPair)}>
                <Trophy className="size-4" />
                {myPair ? '已报名该赛事' : `确认报名并支付 ¥${event.fee}`}
              </Button>
              {myPair && (
                <LinkButton href="/staff/event" size="sm" variant="outline">
                  前往赛事控制台签到编排 →
                </LinkButton>
              )}
            </div>
          </SectionCard>

          <SectionCard title="我的赛事积分" description="积分只用于排名分级，不可当钱消费。">
            <div className="flex flex-col gap-3">
              <StatCard label="成人赛事积分" value={me.eventPoints} unit="分" tone="gold" hint="不可提现、不可消费" />
              {myHistory.length === 0 ? (
                <EmptyHint text="暂无历史赛事战绩" />
              ) : (
                <ul className="flex flex-col gap-2">
                  {myHistory.map((h) => (
                    <li key={h.id} className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2">
                      <span className="text-xs font-medium">{h.eventName}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {h.date} · 第{h.rank}/{h.totalPairs}名 · {h.wins}胜{h.losses}负 · +{h.pointsGained}分
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      <RuleNote title="FR-05 积分口径">
        成人赛事积分与青少年成长积分<strong>不参与任何支付计算</strong>，仅用于排行榜、分级与晋级依据；
        羽球币才是可抵扣消费的虚拟权益。
      </RuleNote>

      <SectionCard title="馆内成人赛事积分榜" description="按累计赛事积分排名，用于分级分区与年度评奖。">
        <ul className="flex flex-col gap-2">
          {leaderboard.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    i < 3
                      ? 'flex size-6 items-center justify-center rounded-full bg-gold/30 font-mono text-xs font-bold text-gold-foreground'
                      : 'flex size-6 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground'
                  }
                >
                  {i + 1}
                </span>
                <span className="text-sm font-medium">{m.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {m.level}
                </Badge>
                {i < 3 && <Medal className="size-3.5 text-gold-foreground" aria-hidden />}
              </div>
              <span className="flex items-center gap-1 font-mono text-sm font-semibold tabular-nums">
                {m.eventPoints}
                <span className="text-[11px] font-normal text-muted-foreground">分</span>
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="报名单位说明" description="赛事以双人组合为最小报名与计分单位。">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-4">
          <Users className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            每组两名选手共用一份积分、胜负与净胜分记录；轮次编排、比分录入、名次折算积分均以组合为单位处理，
            结算成人赛事积分时按组合内成员逐一入账。
          </p>
        </div>
      </SectionCard>
    </div>
  )
}
