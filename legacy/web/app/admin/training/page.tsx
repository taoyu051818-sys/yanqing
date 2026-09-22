'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint, FieldRow, StatusBadge } from '@/components/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDemoStore } from '@/lib/store'
import { round2, trainingContractRate } from '@/lib/finance'

export default function AdminTrainingPage() {
  const courses = useDemoStore((s) => s.courses)
  const enrollments = useDemoStore((s) => s.enrollments)
  const ledger = useDemoStore((s) => s.ledger)
  const params = useDemoStore((s) => s.params)
  const refundTraining = useDemoStore((s) => s.refundTraining)

  const [enrollId, setEnrollId] = useState('')
  const [sessions, setSessions] = useState('')

  const rate = trainingContractRate(params)
  const courseName = (id: string) => courses.find((c) => c.id === id)?.name ?? id

  const stats = useMemo(() => {
    const gross = round2(
      ledger.filter((l) => l.businessType === 'training' && l.kind === '业务收款').reduce((s, l) => s + l.amount, 0),
    )
    const venueShare = round2(ledger.filter((l) => l.kind === '计入球馆流水').reduce((s, l) => s + l.amount, 0))
    const recognized = round2(
      ledger.filter((l) => l.kind === '培训确认收入').reduce((s, l) => s + l.amount, 0),
    )
    const refunded = round2(
      ledger
        .filter((l) => l.businessType === 'training' && l.kind === '退款')
        .reduce((s, l) => s + Math.abs(l.amount), 0),
    )
    return { gross, venueShare, recognized, refunded }
  }, [ledger])

  const refundable = enrollments.filter((e) => e.totalSessions - e.usedSessions > 0)

  const handleRefund = () => {
    if (!enrollId) return toast.error('请选择需要退费的报名记录')
    const n = Number(sessions)
    const target = enrollments.find((e) => e.id === enrollId)
    if (!target) return toast.error('未找到报名记录')
    const remain = target.totalSessions - target.usedSessions
    if (!Number.isInteger(n) || n <= 0) return toast.error('退费课时需为正整数')
    if (n > remain) return toast.error(`剩余课时仅 ${remain} 节，无法退 ${n} 节`)
    const res = refundTraining(enrollId, n, '张总（老板）')
    if (res.ok) {
      toast.success(res.message)
      setSessions('')
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div>
      <PageIntro
        title="培训核算 · 20% 合同口径"
        desc={`培训收款全额进入平台账户，但只有有效流水的 ${Math.round(rate * 100)}% 计入球馆经营流水，其余部分属合同约定的教练方收入。退费按未消耗课时同比例冲回。`}
        rules={[`FR-03 培训计入比例 ${Math.round(rate * 100)}%`, '按已消课确认收入', '退费同比例冲回']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="培训总收款" value={stats.gross.toLocaleString('zh-CN')} unit="元" hint="全额进入平台账户" />
          <StatCard
            label="计入球馆流水"
            value={stats.venueShare.toLocaleString('zh-CN')}
            unit="元"
            hint={`有效流水×${Math.round(rate * 100)}%`}
            tone="primary"
          />
          <StatCard
            label="已确认收入"
            value={stats.recognized.toLocaleString('zh-CN')}
            unit="元"
            hint="按已消课时确认"
            tone="brand"
          />
          <StatCard label="退费冲回" value={stats.refunded.toLocaleString('zh-CN')} unit="元" tone="gold" />
        </div>

        <SectionCard
          title="课程与课包结构"
          description="每个课程的课时数、单价与已售课包数量，用于评估课程收入贡献与教练排课压力。"
        >
          {courses.length === 0 ? (
            <EmptyHint text="暂无课程" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">课程</th>
                    <th className="py-2 pr-3 font-medium">教练</th>
                    <th className="py-2 pr-3 text-right font-medium">课时</th>
                    <th className="py-2 pr-3 text-right font-medium">课包价</th>
                    <th className="py-2 pr-3 text-right font-medium">单节均价</th>
                    <th className="py-2 pr-3 text-right font-medium">已售</th>
                    <th className="py-2 pr-3 text-right font-medium">计入球馆</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c) => {
                    const sold = enrollments.filter((e) => e.courseId === c.id).length
                    return (
                      <tr key={c.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 font-medium text-foreground">{c.name}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{c.coach}</td>
                        <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{c.totalSessions}</td>
                        <td className="py-2 pr-3 text-right font-mono text-foreground">
                          ¥{c.price.toLocaleString('zh-CN')}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                          ¥{round2(c.price / c.totalSessions)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{sold}</td>
                        <td className="py-2 pr-3 text-right font-mono font-medium text-primary">
                          ¥{round2(c.price * sold * rate).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="退费处理"
            description="按未消耗课时退费，系统同步冲回已计入球馆流水的对应比例，保证经营口径不虚高。"
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="enroll-select">报名记录</Label>
                <Select value={enrollId} onValueChange={(v) => v && setEnrollId(v)}>
                  <SelectTrigger id="enroll-select">
                    <SelectValue placeholder="请选择有剩余课时的报名" />
                  </SelectTrigger>
                  <SelectContent>
                    {refundable.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.studentName} · {courseName(e.courseId)} · 余 {e.totalSessions - e.usedSessions} 节
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="refund-sessions">退费课时数</Label>
                <Input
                  id="refund-sessions"
                  value={sessions}
                  onChange={(e) => setSessions(e.target.value)}
                  inputMode="numeric"
                  placeholder="如 4"
                />
              </div>
              <Button size="sm" onClick={handleRefund} className="self-start">
                提交退费
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="在读学员" description="课包消耗进度与状态，剩余课时为退费与排课的依据。">
            {enrollments.length === 0 ? (
              <EmptyHint text="暂无报名记录" />
            ) : (
              <div className="flex flex-col gap-2">
                {enrollments.map((e) => (
                  <div key={e.id} className="flex flex-col gap-1 rounded-xl bg-secondary/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {e.studentName} · {courseName(e.courseId)}
                      </span>
                      <StatusBadge status={e.status} />
                    </div>
                    <FieldRow label="课时进度" value={`${e.usedSessions}/${e.totalSessions} 节`} mono />
                    <FieldRow label="课包金额" value={`¥${e.paidAmount.toLocaleString('zh-CN')}`} mono />
                    <FieldRow
                      label={`计入球馆（${Math.round(rate * 100)}%）`}
                      value={`¥${round2(e.paidAmount * rate).toLocaleString('zh-CN')}`}
                      mono
                    />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <RuleNote title={`为什么只计入 ${Math.round(rate * 100)}%`}>
          培训业务由合作教练团队执行，合同约定球馆按培训有效流水的 {Math.round(rate * 100)}%
          分成。若把全额收款计入球馆流水，会显著虚增经营规模并误导定价与投放决策。因此系统在收款时即拆分：全额进平台账户用于资金安全，仅按比例生成「计入球馆流水」记录参与经营分析。
        </RuleNote>
      </div>
    </div>
  )
}
