'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Shuffle, Flag, ClipboardCheck } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, FlowProgress, EmptyHint, RuleNote } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { rankPairs, pairName, BYE_ID } from '@/lib/swiss'

export default function StaffEventPage() {
  const events = useDemoStore((s) => s.events)
  const checkInEventPair = useDemoStore((s) => s.checkInEventPair)
  const checkInAllPairs = useDemoStore((s) => s.checkInAllPairs)
  const startNextRound = useDemoStore((s) => s.startNextRound)
  const submitMatchScore = useDemoStore((s) => s.submitMatchScore)
  const finishEvent = useDemoStore((s) => s.finishEvent)

  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [scores, setScores] = useState<Record<string, { a: string; b: string }>>({})

  const event = events.find((e) => e.id === eventId) ?? events[0]
  const ranked = useMemo(() => (event ? rankPairs(event.pairs) : []), [event])
  const currentMatches = useMemo(
    () => (event ? event.matches.filter((m) => m.round === event.currentRound) : []),
    [event],
  )
  const pairById = (id: string) => event?.pairs.find((p) => p.id === id)

  if (!event) return <EmptyHint text="暂无赛事" />

  const checkedCount = event.pairs.filter((p) => p.checkedIn).length
  const pendingScores = currentMatches.filter((m) => !m.confirmed).length
  const allRoundsDone = event.currentRound >= event.totalRounds && pendingScores === 0

  const handleScore = (matchId: string) => {
    const v = scores[matchId]
    const a = Number(v?.a)
    const b = Number(v?.b)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      toast.error('请输入双方有效比分（非负整数）')
      return
    }
    if (a === b) {
      toast.error('羽毛球赛制不存在平局，请核对比分')
      return
    }
    const res = submitMatchScore(event.id, matchId, a, b)
    if (res.ok) {
      toast.success(res.message)
      setScores((s) => ({ ...s, [matchId]: { a: '', b: '' } }))
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="赛事控制台"
        desc="组合签到 → 系统按瑞士制编排轮次 → 现场录入比分 → 自动重算积分与排名 → 结赛折算成人赛事积分。"
        rules={['积分接近配对', '避免重复对手', '奇数轮空计1分', '结赛自动入账积分']}
      >
        <Select value={eventId} onValueChange={(v) => v && setEventId(v)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {events.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageIntro>

      <FlowProgress flow={FLOWS[1]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="赛事状态" value={event.status} hint={`${event.date} ${event.venue}`} />
        <StatCard label="已签到组合" value={`${checkedCount}/${event.pairs.length}`} unit="组" tone="brand" />
        <StatCard label="当前轮次" value={`${event.currentRound}/${event.totalRounds}`} unit="轮" tone="primary" />
        <StatCard label="待录比分" value={pendingScores} unit="场" tone="gold" />
      </div>

      <SectionCard
        title="第一步：组合签到"
        description="仅已签到的组合参与轮次编排，未签到组合自动不计入本轮配对。"
        action={
          <Button size="sm" variant="outline" onClick={() => toast.success(checkInAllPairs(event.id).message)}>
            <ClipboardCheck className="size-3.5" />
            全部签到
          </Button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {event.pairs.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{pairName(p)}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  种子{p.seed} · {p.points}分 · {p.wins}胜{p.losses}负
                </span>
              </div>
              {p.checkedIn ? (
                <Badge variant="outline" className="gap-1 border-brand/40 text-brand-foreground">
                  <CheckCircle2 className="size-3" aria-hidden />
                  已签到
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const res = checkInEventPair(event.id, p.id)
                    res.ok ? toast.success(res.message) : toast.error(res.message)
                  }}
                >
                  签到
                </Button>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={`第二步：轮次编排（当前第 ${event.currentRound} 轮）`}
        description="点击生成下一轮，系统按积分排序两两配对，跳过已交手过的组合，奇数组合自动轮空并计1分。"
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const res = startNextRound(event.id)
                res.ok ? toast.success(res.message) : toast.error(res.message)
              }}
            >
              <Shuffle className="size-3.5" />
              生成下一轮对阵
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!allRoundsDone}
              onClick={() => {
                const res = finishEvent(event.id)
                res.ok ? toast.success(res.message) : toast.error(res.message)
              }}
            >
              <Flag className="size-3.5" />
              结赛并折算积分
            </Button>
          </div>
        }
      >
        {currentMatches.length === 0 ? (
          <EmptyHint text="本轮暂无对阵，请先签到组合并生成对阵" />
        ) : (
          <div className="flex flex-col gap-2">
            {currentMatches.map((m) => {
              const a = pairById(m.pairAId)
              const b = pairById(m.pairBId)
              const v = scores[m.id] ?? { a: '', b: '' }
              return (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {m.court} · {pairName(a)} <span className="text-muted-foreground">vs</span> {pairName(b)}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {m.id} · 第{m.round}轮
                      {m.corrected && ' · 已修正'}
                    </span>
                  </div>
                  {m.confirmed ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {m.scoreA} : {m.scoreB}
                      </span>
                      <Badge variant="outline" className="border-brand/40 text-brand-foreground">
                        已确认
                      </Badge>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="A方比分"
                        className="w-16 text-center font-mono"
                        inputMode="numeric"
                        value={v.a}
                        onChange={(e) => setScores((s) => ({ ...s, [m.id]: { ...v, a: e.target.value } }))}
                      />
                      <span className="text-muted-foreground">:</span>
                      <Input
                        aria-label="B方比分"
                        className="w-16 text-center font-mono"
                        inputMode="numeric"
                        value={v.b}
                        onChange={(e) => setScores((s) => ({ ...s, [m.id]: { ...v, b: e.target.value } }))}
                      />
                      <Button size="sm" onClick={() => handleScore(m.id)}>
                        录入
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <RuleNote title="瑞士制编排口径">
        每轮配对遵循「积分接近优先」；若最优对手已交手过，则顺延至下一位未交手组合。奇数组合时，
        取排名最低且<strong>尚未轮空</strong>过的组合轮空并计 1 分，保证同一组合不会重复轮空。
      </RuleNote>

      <SectionCard title="实时积分榜" description="排名规则：积分 → 净胜分 → 胜场 → 种子序。">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">排名</TableHead>
                <TableHead>组合</TableHead>
                <TableHead className="text-right">积分</TableHead>
                <TableHead className="text-right">胜/负</TableHead>
                <TableHead className="text-right">净胜分</TableHead>
                <TableHead>已交手对手</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                  <TableCell className="text-sm">{pairName(p)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium tabular-nums">{p.points}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {p.wins}/{p.losses}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {p.scoreDiff > 0 ? '+' : ''}
                    {p.scoreDiff}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.opponents.length === 0
                      ? '—'
                      : p.opponents
                          .map((o) => (o === BYE_ID ? '轮空' : pairName(pairById(o))))
                          .join('、')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </div>
  )
}
