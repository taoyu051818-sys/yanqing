'use client'

import { useMemo, useState } from 'react'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint } from '@/components/blocks'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDemoStore } from '@/lib/store'

export default function AdminAuditPage() {
  const logs = useDemoStore((s) => s.auditLogs)
  const [role, setRole] = useState('全部')
  const [q, setQ] = useState('')

  const roles = useMemo(() => ['全部', ...Array.from(new Set(logs.map((l) => l.role)))], [logs])

  const list = useMemo(
    () =>
      logs.filter(
        (l) =>
          (role === '全部' || l.role === role) &&
          (q.trim() === '' ||
            l.action.includes(q.trim()) ||
            l.target.includes(q.trim()) ||
            l.actor.includes(q.trim())),
      ),
    [logs, role, q],
  )

  const withReason = logs.filter((l) => l.note && l.note.trim() !== '').length
  const withDiff = logs.filter((l) => l.before !== undefined || l.after !== undefined).length

  return (
    <div>
      <PageIntro
        title="审计日志 · 敏感操作留痕"
        desc="退款、比分修正、账户人工调整、参数变更与券码核销等敏感操作全部强制留痕，记录操作人、角色、时间、变更前后值与原因，任何环节都无法静默修改数据。"
        rules={['敏感操作强制留痕', '记录变更前后值', '原因必填']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="审计记录" value={logs.length} unit="条" tone="primary" />
          <StatCard label="含原因说明" value={withReason} unit="条" tone="brand" />
          <StatCard label="含前后值对比" value={withDiff} unit="条" tone="gold" />
        </div>

        <SectionCard title="筛选" description="按操作角色筛选，或按操作类型、对象、操作人检索。">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="audit-role">操作角色</Label>
              <Select value={role} onValueChange={(v) => v && setRole(v)}>
                <SelectTrigger id="audit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="audit-q">关键词</Label>
              <Input
                id="audit-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="如 退款、比分修正、账户调整"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="操作记录"
          description="按时间倒序展示。变更前后值以对照形式呈现，便于争议追溯与责任界定。"
        >
          {list.length === 0 ? (
            <EmptyHint text="没有符合条件的审计记录" />
          ) : (
            <ol className="flex flex-col gap-2">
              {list.map((l) => (
                <li key={l.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-sm text-[10px]">
                        {l.action}
                      </Badge>
                      <span className="text-xs font-medium text-foreground">{l.target}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">{l.at}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      操作人 <span className="text-foreground">{l.actor}</span>
                    </span>
                    <span className="text-border">|</span>
                    <span>角色 {l.role}</span>
                  </div>

                  {(l.before !== undefined || l.after !== undefined) && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px]">
                      <span className="text-destructive line-through">{l.before ?? '（空）'}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-brand-foreground">{l.after ?? '（空）'}</span>
                    </div>
                  )}

                  {l.note && <span className="text-pretty text-[11px] leading-relaxed text-muted-foreground">原因：{l.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <RuleNote title="审计为什么必须前置">
          审计不是事后补录的台账，而是敏感操作的执行前提：系统在退款、改分、调账、改参数时强制要求填写原因，未填写则操作无法提交。这样一旦出现资金或成绩争议，可以直接定位到具体经办人与决策依据。
        </RuleNote>
      </div>
    </div>
  )
}
