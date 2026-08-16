'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, FlowProgress, EmptyHint, RuleNote } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { computeTrainingSummary, yuan } from '@/lib/finance'

const COACH = '教练-赵岩'

export default function StaffTrainingPage() {
  const courses = useDemoStore((s) => s.courses)
  const enrollments = useDemoStore((s) => s.enrollments)
  const sessionLogs = useDemoStore((s) => s.sessionLogs)
  const params = useDemoStore((s) => s.params)
  const consumeTrainingSession = useDemoStore((s) => s.consumeTrainingSession)

  const summary = useMemo(() => computeTrainingSummary(enrollments, sessionLogs, params), [
    enrollments,
    sessionLogs,
    params,
  ])
  const active = enrollments.filter((e) => e.totalSessions - e.usedSessions > 0)

  const handleConsume = (id: string) => {
    const res = consumeTrainingSession(id, COACH)
    res.ok ? toast.success(res.message) : toast.error(res.message)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="教练消课台"
        desc="每次上课后由教练确认消课，系统同步确认收入、扣减预收余额、累积学员成长积分，并记录占用场地资源用于效率分析。"
        rules={['消课才确认收入', '预收余额同步扣减', '占场不计场地费']}
      />

      <FlowProgress flow={FLOWS[2]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="已确认收入" value={yuan(summary.confirmedRevenue)} hint="培训有效流水" tone="brand" />
        <StatCard label="未消课预收" value={yuan(summary.unusedBalance)} hint="可退费部分" tone="gold" />
        <StatCard
          label={`计入球馆流水（${Math.round(summary.rate * 100)}%）`}
          value={yuan(summary.contractContribution)}
          hint="合同口径"
          tone="primary"
        />
        <StatCard label="培训场地费" value={yuan(summary.trainingVenueFee)} hint="合同约定恒为 0" />
      </div>

      <SectionCard title="在读学员消课" description="点击「确认消课」记录一次课时，确认收入按课时单价结转。">
        {active.length === 0 ? (
          <EmptyHint text="暂无剩余课时的在读学员" />
        ) : (
          <div className="flex flex-col gap-3">
            {active.map((e) => {
              const c = courses.find((x) => x.id === e.courseId)
              const remaining = e.totalSessions - e.usedSessions
              const pct = Math.round((e.usedSessions / e.totalSessions) * 100)
              return (
                <div
                  key={e.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{e.studentName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c?.name}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {c?.audience}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        单价 {yuan(e.unitPrice)} · 剩余 {remaining} 课时
                      </span>
                    </div>
                    <Progress value={pct} aria-label={`${e.studentName} 消课进度`} />
                  </div>
                  <Button size="sm" onClick={() => handleConsume(e.id)}>
                    <CheckCircle2 className="size-3.5" />
                    确认消课
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <RuleNote title="占场资源口径">
        培训每次课占用的场地片数与小时数会被记录，用于计算<strong>资源效率</strong>（如坪效、时段占用），
        但按合同约定<strong>不产生培训应付场地费</strong>，当前培训应付账款为 {yuan(summary.trainingPayableFromVenue)}。
      </RuleNote>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="占用场地片次" value={summary.occupiedCourtCount} unit="片次" hint="仅效率分析" />
        <StatCard label="占用场地小时" value={summary.occupiedHours} unit="小时" hint="仅效率分析" />
        <StatCard label="教练成本" value={yuan(summary.coachCost)} />
        <StatCard label="培训毛利" value={yuan(summary.grossProfit)} tone="brand" hint="扣教练与耗材成本" />
      </div>

      <SectionCard title="消课记录" description="每条记录含确认收入、教练成本、耗材成本与占场资源，供培训独立核算使用。">
        {sessionLogs.length === 0 ? (
          <EmptyHint text="暂无消课记录" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>学员</TableHead>
                  <TableHead className="text-right">确认收入</TableHead>
                  <TableHead className="text-right">教练成本</TableHead>
                  <TableHead className="text-right">耗材</TableHead>
                  <TableHead className="text-right">占场</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{l.date}</TableCell>
                    <TableCell className="text-sm">{l.studentName}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-brand-foreground">
                      {yuan(l.confirmedAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{yuan(l.coachCost)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{yuan(l.materialCost)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {l.courtCount}片 × {l.hours}h
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.operator}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
