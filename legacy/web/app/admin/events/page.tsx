'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint } from '@/components/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDemoStore } from '@/lib/store'
import { rankPairs } from '@/lib/swiss'
import { EventRulesModule } from '@/components/extended-modules'

export default function AdminEventsPage() {
  const events = useDemoStore((s) => s.events)
  const members = useDemoStore((s) => s.members)
  const correctMatchScore = useDemoStore((s) => s.correctMatchScore)
  const finishEvent = useDemoStore((s) => s.finishEvent)

  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const event = events.find((e) => e.id === eventId) ?? events[0]

  const [matchId, setMatchId] = useState('')
  const [scoreA, setScoreA] = useState('')
  const [scoreB, setScoreB] = useState('')
  const [reason, setReason] = useState('')

  const pairName = (id: string) => {
    const p = event?.pairs.find((x) => x.id === id)
    return p ? `${p.playerA}/${p.playerB}` : id
  }

  /** 已录分的比赛，可申请修正 */
  const finishedMatches = useMemo(
    () => (event?.matches ?? []).filter((m) => m.scoreA !== null && m.scoreB !== null),
    [event],
  )

  const standings = useMemo(() => rankPairs(event?.pairs ?? []), [event])

  const handleCorrect = () => {
    if (!matchId) return toast.error('请选择需要修正的比赛')
    if (!reason.trim()) return toast.error('比分修正必须填写原因，用于审计留痕')
    const a = Number(scoreA)
    const b = Number(scoreB)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return toast.error('比分需为非负整数')
    if (a === b) return toast.error('瑞士积分赛不允许平分')
    const res = correctMatchScore(event.id, matchId, a, b, '张总（老板）', reason.trim())
    if (res.ok) {
      toast.success(res.message)
      setScoreA('')
      setScoreB('')
      setReason('')
    } else {
      toast.error(res.message)
    }
  }

  if (!event) {
    return <EmptyHint text="暂无赛事数据" />
  }

  return (
    <div>
      <PageIntro
        title="赛事管理 · 比分修正与积分排行"
        desc="老板与赛事负责人可对已录入的比分进行修正，每次修正强制填写原因并留下审计记录；积分排行按胜场、小分与对手分依次排序。"
        rules={['修正必须填原因', '修正写入审计日志', '积分自动重算']}
      >
        <Select value={eventId} onValueChange={(v) => v && setEventId(v)}>
          <SelectTrigger className="w-56" aria-label="选择赛事">
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

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="报名组合" value={event.pairs.length} unit="组" tone="primary" />
          <StatCard label="已完成轮次" value={event.currentRound} unit={`/${event.totalRounds}`} tone="brand" />
          <StatCard label="已录分比赛" value={finishedMatches.length} unit="场" />
          <StatCard label="赛事状态" value={event.status} tone="gold" />
        </div>

        <SectionCard
          title="比分修正"
          description="修正后系统立即重算全部积分与排名，并在审计日志中记录修正前后的比分、操作人与原因。"
        >
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="match-select">选择比赛</Label>
                <Select value={matchId} onValueChange={(v) => v && setMatchId(v)}>
                  <SelectTrigger id="match-select">
                    <SelectValue placeholder="请选择已录分的比赛" />
                  </SelectTrigger>
                  <SelectContent>
                    {finishedMatches.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        第{m.round}轮 {pairName(m.pairAId)} {m.scoreA}:{m.scoreB} {pairName(m.pairBId)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="fix-a">修正后A方</Label>
                  <Input id="fix-a" value={scoreA} onChange={(e) => setScoreA(e.target.value)} inputMode="numeric" />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="fix-b">修正后B方</Label>
                  <Input id="fix-b" value={scoreB} onChange={(e) => setScoreB(e.target.value)} inputMode="numeric" />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fix-reason">修正原因（必填）</Label>
              <Input
                id="fix-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：记分员误录，经双方队长确认后更正"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleCorrect}>
                提交修正
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const res = finishEvent(event.id)
                  if (res.ok) toast.success(res.message)
                  else toast.error(res.message)
                }}
              >
                结束赛事并结算积分
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="积分排行"
          description="排序规则：胜场优先，其次净胜分，再次对手分（Buchholz）。赛事结束后按名次发放成人赛事积分。"
        >
          {standings.length === 0 ? (
            <EmptyHint text="暂无报名组合" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">名次</th>
                    <th className="py-2 pr-3 font-medium">组合</th>
                    <th className="py-2 pr-3 text-right font-medium">积分</th>
                    <th className="py-2 pr-3 text-right font-medium">胜/负</th>
                    <th className="py-2 pr-3 text-right font-medium">净胜分</th>
                    <th className="py-2 pr-3 font-medium">签到</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((p, i) => (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 font-mono font-semibold text-foreground">{i + 1}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {p.playerA}/{p.playerB}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {p.memberIds
                              .map((id) => members.find((m) => m.id === id)?.name)
                              .filter(Boolean)
                              .join(' / ')}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-primary">{p.points}</td>
                      <td className="py-2 pr-3 text-right font-mono text-foreground">
                        {p.wins}/{p.losses}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                        {p.scoreDiff > 0 ? '+' : ''}
                        {p.scoreDiff}
                      </td>
                      <td className="py-2 pr-3">
                        {p.checkedIn ? (
                          <Badge variant="secondary" className="rounded-sm text-[10px]">
                            已签到
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-sm text-[10px]">
                            未签到
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <EventRulesModule />

        <RuleNote title="为什么修正必须留痕">
          比分直接影响积分排名与赛事积分发放，属于敏感操作。系统不提供静默修改能力：任何修正都会生成审计记录（操作人、时间、修正前后值、原因），确保争议可回溯、责任可追踪。
        </RuleNote>
      </div>
    </div>
  )
}
