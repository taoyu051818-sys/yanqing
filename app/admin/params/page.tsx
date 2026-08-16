'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint } from '@/components/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'

const GROUPS = ['场地价格', '培训财务', '联盟与券', '会员权益', '赛事规则'] as const

export default function AdminParamsPage() {
  const params = useDemoStore((s) => s.params)
  const updateParam = useDemoStore((s) => s.updateParam)

  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [from, setFrom] = useState(DEMO_TODAY)

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ group: g, items: params.filter((p) => p.group === g) })),
    [params],
  )

  const lockedCount = params.filter((p) => p.locked).length
  const changedCount = params.filter((p) => p.history.length > 0).length

  const startEdit = (key: string, current: string) => {
    setEditing(key)
    setValue(current)
    setFrom(DEMO_TODAY)
  }

  const submit = (key: string) => {
    if (!value.trim()) return toast.error('参数值不能为空')
    const res = updateParam(key, value.trim(), from, '张总（老板）')
    if (res.ok) {
      toast.success(res.message)
      setEditing(null)
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div>
      <PageIntro
        title="参数中心 · 价格与规则版本管理"
        desc="所有价格与业务规则集中配置，修改需指定生效日期并形成版本历史。财务口径类参数被锁定，防止随意调整导致历史数据不可比。"
        rules={['修改需指定生效日期', '关键口径参数锁定', '历史订单不追溯重算']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="参数总数" value={params.length} unit="项" tone="primary" />
          <StatCard label="已锁定" value={lockedCount} unit="项" hint="财务口径不可改" tone="gold" />
          <StatCard label="有变更历史" value={changedCount} unit="项" tone="brand" />
        </div>

        <Tabs defaultValue={GROUPS[0]}>
          <TabsList className="flex-wrap">
            {GROUPS.map((g) => (
              <TabsTrigger key={g} value={g}>
                {g}
              </TabsTrigger>
            ))}
          </TabsList>

          {grouped.map(({ group, items }) => (
            <TabsContent key={group} value={group} className="mt-4">
              <SectionCard
                title={group}
                description="点击「修改」输入新值与生效日期。已锁定参数会显示锁定原因，需线下审批后由系统管理员解锁。"
              >
                {items.length === 0 ? (
                  <EmptyHint text="该分组暂无参数" />
                ) : (
                  <div className="flex flex-col gap-2">
                    {items.map((p) => (
                      <div key={p.key} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-foreground">{p.name}</span>
                              <span className="font-mono text-[10px] text-muted-foreground">{p.key}</span>
                              {p.locked && (
                                <Badge variant="outline" className="gap-1 rounded-sm text-[10px]">
                                  <Lock className="size-2.5" />
                                  已锁定
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              当前值 <span className="font-mono text-foreground">{p.value}</span> {p.unit} · 生效于{' '}
                              {p.effectiveFrom}
                            </span>
                            {p.locked && p.lockReason && (
                              <span className="text-[11px] text-gold-foreground">锁定原因：{p.lockReason}</span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={p.locked}
                            onClick={() => startEdit(p.key, p.value)}
                          >
                            {p.locked ? '不可修改' : '修改'}
                          </Button>
                        </div>

                        {editing === p.key && (
                          <div className="grid gap-3 rounded-md border border-primary/25 bg-primary/[0.04] p-3 sm:grid-cols-[1fr_1fr_auto]">
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor={`v-${p.key}`}>新值（{p.unit}）</Label>
                              <Input id={`v-${p.key}`} value={value} onChange={(e) => setValue(e.target.value)} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor={`f-${p.key}`}>生效日期</Label>
                              <Input
                                id={`f-${p.key}`}
                                type="date"
                                value={from}
                                onChange={(e) => setFrom(e.target.value)}
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button size="sm" onClick={() => submit(p.key)}>
                                保存
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                                取消
                              </Button>
                            </div>
                          </div>
                        )}

                        {p.history.length > 0 && (
                          <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
                            <span className="text-[11px] font-medium text-muted-foreground">变更历史</span>
                            {p.history.map((h, i) => (
                              <span key={i} className="font-mono text-[11px] text-muted-foreground">
                                {h.changedAt} · {h.changedBy} 改为 {h.value}（{h.effectiveFrom} 起生效）
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </TabsContent>
          ))}
        </Tabs>

        <RuleNote title="参数版本与历史数据的关系">
          参数修改只对生效日期之后的新订单起作用，历史订单一律按下单时的参数版本结算，系统不做追溯重算。培训 20%
          合同口径、五类账户规则等属于财务基础口径，默认锁定，避免修改后导致跨期报表不可比。
        </RuleNote>
      </div>
    </div>
  )
}
