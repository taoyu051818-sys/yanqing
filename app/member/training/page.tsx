'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { GraduationCap, Sprout } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, FieldRow, FlowProgress, EmptyHint, RuleNote } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { LinkButton } from '@/components/link-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { yuan } from '@/lib/finance'

export default function MemberTrainingPage() {
  const courses = useDemoStore((s) => s.courses)
  const enrollments = useDemoStore((s) => s.enrollments)
  const sessionLogs = useDemoStore((s) => s.sessionLogs)
  const members = useDemoStore((s) => s.members)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const purchaseTraining = useDemoStore((s) => s.purchaseTraining)

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [studentName, setStudentName] = useState('')
  const [guardian, setGuardian] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')

  const course = courses.find((c) => c.id === courseId) ?? courses[0]
  const myEnrollments = useMemo(() => enrollments.filter((e) => e.memberId === me.id), [enrollments, me.id])

  const handlePurchase = () => {
    if (!course) return
    if (!studentName.trim()) {
      toast.error('请填写学员姓名')
      return
    }
    if (course.audience === '青少年' && (!guardian.trim() || !guardianPhone.trim())) {
      toast.error('青少年课程必须登记监护人姓名与联系电话')
      return
    }
    const res = purchaseTraining({
      courseId: course.id,
      memberId: me.id,
      studentName: studentName.trim(),
      guardian: guardian.trim() || me.name,
      guardianPhone: guardianPhone.trim() || me.phone,
    })
    if (res.ok) {
      toast.success(res.message)
      setStudentName('')
    } else {
      toast.error(res.message)
    }
  }

  if (!course) return <EmptyHint text="暂无课程" />

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="培训课程 · 课包购买与消课"
        desc="培训业务独立建账，收款主体为「培训中心」。购课形成预收，每次消课才确认收入；未消课部分保留为预收余额可按剩余课时退费。"
        rules={['独立账套', '消课确认收入', '预收可退', '按剩余课时计算']}
      />

      <FlowProgress flow={FLOWS[2]} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <SectionCard title="可购课程" description="点击选择课程，右侧填写学员信息完成购课。">
            <div className="grid gap-3 sm:grid-cols-2">
              {courses.map((c) => {
                const active = c.id === courseId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCourseId(c.id)}
                    aria-pressed={active}
                    className={
                      active
                        ? 'flex flex-col gap-2 rounded-lg border-2 border-primary bg-primary/5 p-4 text-left transition-colors'
                        : 'flex flex-col gap-2 rounded-xl bg-secondary/50 p-4 text-left transition-colors hover:border-primary/40'
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{c.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.audience}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      教练 {c.coach} · {c.schedule}
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-xl font-bold text-primary">{yuan(c.price)}</span>
                      <span className="text-[11px] text-muted-foreground">
                        / {c.totalSessions}课时（单价 {yuan(c.unitPrice)}）
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      每次课占用 {c.courtCountPerSession} 片场地 · {c.hoursPerSession} 小时
                    </span>
                  </button>
                )
              })}
            </div>
          </SectionCard>

          <SectionCard title="我的课包与消课进度" description="每次消课由教练在员工端确认，进度实时同步。">
            {myEnrollments.length === 0 ? (
              <EmptyHint text="暂无课包，右侧可购买课程" />
            ) : (
              <div className="flex flex-col gap-3">
                {myEnrollments.map((e) => {
                  const c = courses.find((x) => x.id === e.courseId)
                  const remaining = e.totalSessions - e.usedSessions
                  const pct = Math.round((e.usedSessions / e.totalSessions) * 100)
                  const logs = sessionLogs.filter((l) => l.enrollmentId === e.id)
                  return (
                    <div key={e.id} className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold">
                            {c?.name} · 学员 {e.studentName}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {e.id} · 监护人 {e.guardian} {e.guardianPhone}
                          </span>
                        </div>
                        <Badge variant="outline">{e.status}</Badge>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            已消 {e.usedSessions} / {e.totalSessions} 课时
                          </span>
                          <span className="font-mono text-muted-foreground">剩余 {remaining} 课时</span>
                        </div>
                        <Progress value={pct} aria-label="消课进度" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <StatCard label="已确认收入" value={yuan(e.confirmedRevenue)} hint="消课确认部分" tone="brand" />
                        <StatCard label="未消课余额" value={yuan(e.unusedBalance)} hint="可按剩余课时退费" tone="gold" />
                        <StatCard label="已退费" value={yuan(e.refundAmount)} />
                      </div>
                      {logs.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">最近消课记录</span>
                          <ul className="flex flex-col gap-1">
                            {logs.slice(0, 3).map((l) => (
                              <li key={l.id} className="font-mono text-[11px] text-muted-foreground">
                                {l.date} · 确认收入 {yuan(l.confirmedAmount)} · 操作 {l.operator}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <SectionCard title="购买课包" description="青少年课程必须登记监护人信息，便于安全联络与成长档案归属。">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col">
                <FieldRow label="所选课程" value={course.name} />
                <FieldRow label="课时/价格" value={`${course.totalSessions}课时 / ${yuan(course.price)}`} mono />
                <FieldRow label="业务类型" value="培训（training）" />
                <FieldRow label="收款主体" value="培训中心（独立账套）" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="student">学员姓名</Label>
                <Input
                  id="student"
                  value={studentName}
                  placeholder="如 刘一诺"
                  onChange={(e) => setStudentName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="guardian">
                  监护人姓名{course.audience === '青少年' ? '（必填）' : '（选填）'}
                </Label>
                <Input
                  id="guardian"
                  value={guardian}
                  placeholder={me.name}
                  onChange={(e) => setGuardian(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="phone">
                  监护人电话{course.audience === '青少年' ? '（必填）' : '（选填）'}
                </Label>
                <Input
                  id="phone"
                  value={guardianPhone}
                  placeholder={me.phone}
                  inputMode="tel"
                  onChange={(e) => setGuardianPhone(e.target.value)}
                />
              </div>
              <Button onClick={handlePurchase}>
                <GraduationCap className="size-4" />
                确认购课 {yuan(course.price)}
              </Button>
              <LinkButton href="/staff/training" size="sm" variant="outline">
                前往教练端消课 →
              </LinkButton>
            </div>
          </SectionCard>

          <SectionCard title="青少年成长积分" description="消课与考核累积成长值，仅用于成长档案与晋级。">
            <div className="flex flex-col gap-2">
              <StatCard label="成长积分" value={me.growthPoints} unit="分" tone="brand" hint="不可当钱消费" />
              <div className="flex items-start gap-2 rounded-lg bg-secondary/50 bg-secondary/40 px-3 py-2">
                <Sprout className="mt-0.5 size-3.5 text-brand-foreground" aria-hidden />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  成长积分随消课与阶段考核累积，用于展示技术等级进度、评定晋级班型，不参与任何支付抵扣。
                </p>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <RuleNote title="培训财务口径（合同强规则）">
        培训业务<strong>独立建账</strong>；培训实际有效流水（已确认收入）的 <strong>20%</strong> 计入球馆合同流水；
        培训占用场地<strong>不再另付场地费</strong>，占场片数与小时仅用于资源效率分析。
      </RuleNote>
    </div>
  )
}
