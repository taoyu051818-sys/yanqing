'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint } from '@/components/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDemoStore, type AccountKind } from '@/lib/store'
import { round2 } from '@/lib/finance'

const ACCOUNTS: AccountKind[] = ['现金本金余额', '赠送余额', '羽球币', '成人赛事积分', '青少年成长积分']

const ACCOUNT_FIELD: Record<AccountKind, 'cashBalance' | 'giftBalance' | 'coins' | 'eventPoints' | 'growthPoints'> = {
  现金本金余额: 'cashBalance',
  赠送余额: 'giftBalance',
  羽球币: 'coins',
  成人赛事积分: 'eventPoints',
  青少年成长积分: 'growthPoints',
}

export default function AdminMembersPage() {
  const members = useDemoStore((s) => s.members)
  const txns = useDemoStore((s) => s.txns)
  const referrals = useDemoStore((s) => s.referrals)
  const adjustAccount = useDemoStore((s) => s.adjustAccount)

  const [memberId, setMemberId] = useState(members[0]?.id ?? '')
  const [account, setAccount] = useState<AccountKind>('赠送余额')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [q, setQ] = useState('')

  const list = useMemo(
    () =>
      members.filter(
        (m) => q.trim() === '' || m.name.includes(q.trim()) || m.phone.includes(q.trim()),
      ),
    [members, q],
  )

  const totals = useMemo(
    () => ({
      cash: round2(members.reduce((s, m) => s + m.cashBalance, 0)),
      gift: round2(members.reduce((s, m) => s + m.giftBalance, 0)),
      coins: members.reduce((s, m) => s + m.coins, 0),
      points: members.reduce((s, m) => s + m.eventPoints + m.growthPoints, 0),
    }),
    [members],
  )

  const handleAdjust = () => {
    const n = Number(delta)
    if (!memberId) return toast.error('请选择会员')
    if (!Number.isFinite(n) || n === 0) return toast.error('调整值需为非零数字')
    if (!reason.trim()) return toast.error('人工调整必须填写原因，用于审计留痕')
    const res = adjustAccount(memberId, account, n, reason.trim(), '张总（老板）')
    if (res.ok) {
      toast.success(res.message)
      setDelta('')
      setReason('')
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div>
      <PageIntro
        title="会员与账户 · 五类账户独立核算"
        desc="现金本金余额、赠送余额、羽球币、成人赛事积分与青少年成长积分严格分开，互不冲抵。人工调整属敏感操作，必须填写原因并留下审计记录。"
        rules={['FR-05 五类账户不互抵', '仅现金本金可退', '调整必须留痕']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="现金本金余额" value={totals.cash.toLocaleString('zh-CN')} unit="元" hint="可退可提" tone="primary" />
          <StatCard label="赠送余额" value={totals.gift.toLocaleString('zh-CN')} unit="元" hint="不可退" tone="gold" />
          <StatCard label="羽球币" value={totals.coins.toLocaleString('zh-CN')} unit="币" hint="权益兑换" tone="brand" />
          <StatCard label="积分合计" value={totals.points.toLocaleString('zh-CN')} unit="分" hint="赛事+成长" />
        </div>

        <SectionCard
          title="人工账户调整"
          description="用于处理投诉补偿、系统异常修正等场景。调整只影响所选的单一账户，不会联动其他账户。"
        >
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adj-member">会员</Label>
                <Select value={memberId} onValueChange={(v) => v && setMemberId(v)}>
                  <SelectTrigger id="adj-member">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} · {m.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adj-account">账户类型</Label>
                <Select value={account} onValueChange={(v) => v && setAccount(v as AccountKind)}>
                  <SelectTrigger id="adj-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNTS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="adj-delta">调整值（正增负减）</Label>
                <Input
                  id="adj-delta"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="如 100 或 -50"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="adj-reason">调整原因（必填）</Label>
              <Input
                id="adj-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：因场地设备故障导致体验受损，补偿赠送余额"
              />
            </div>
            <Button size="sm" onClick={handleAdjust} className="self-start">
              提交调整
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="会员账户总览"
          description="五列账户并排展示，任何一列都不能用于抵扣另一列。"
          action={
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索姓名或手机号"
              className="h-8 w-48"
              aria-label="搜索会员"
            />
          }
        >
          {list.length === 0 ? (
            <EmptyHint text="没有匹配的会员" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">会员</th>
                    <th className="py-2 pr-3 font-medium">等级</th>
                    {ACCOUNTS.map((a) => (
                      <th key={a} className="py-2 pr-3 text-right font-medium">
                        {a}
                      </th>
                    ))}
                    <th className="py-2 pr-3 text-right font-medium">30日到场</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr key={m.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{m.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{m.phone}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="rounded-sm text-[10px]">
                          {m.level}
                        </Badge>
                      </td>
                      {ACCOUNTS.map((a) => (
                        <td key={a} className="py-2 pr-3 text-right font-mono text-foreground">
                          {m[ACCOUNT_FIELD[a]].toLocaleString('zh-CN')}
                        </td>
                      ))}
                      <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{m.visits30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="推荐奖励（仅一层）" description="推荐关系只记录直接推荐人，不做多层级分佣，奖励在观察期结束后发放。">
            {referrals.length === 0 ? (
              <EmptyHint text="暂无推荐记录" />
            ) : (
              <div className="flex flex-col gap-2">
                {referrals.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-secondary/50 p-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-foreground">
                        {r.referrerName} → {r.inviteeName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{r.note}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {r.createdAt} · 解锁 {r.releaseAt}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-mono text-xs font-semibold text-brand-foreground">
                        +{r.rewardCoins} 羽球币
                      </span>
                      <Badge variant="outline" className="rounded-sm text-[10px]">
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="最近账户流水" description="每一笔账户变动都记录账户类型、变动值与业务来源。">
            {txns.length === 0 ? (
              <EmptyHint text="暂无账户流水" />
            ) : (
              <div className="flex flex-col gap-1.5">
                {txns.slice(0, 12).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-foreground">{t.reason}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t.at} · {t.account}
                      </span>
                    </div>
                    <span
                      className={
                        t.delta < 0
                          ? 'font-mono text-xs font-medium text-destructive'
                          : 'font-mono text-xs font-medium text-brand-foreground'
                      }
                    >
                      {t.delta > 0 ? '+' : ''}
                      {t.delta.toLocaleString('zh-CN')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <RuleNote title="五类账户为什么不能互抵">
          现金本金余额是会员实付资金，具备退款义务；赠送余额是营销成本，不可退现；羽球币与两类积分是权益激励，不构成负债。若允许互相冲抵，将无法区分真实负债与营销费用，退款与税务处理都会出错。
        </RuleNote>
      </div>
    </div>
  )
}
