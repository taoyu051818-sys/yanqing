'use client'

import { useMemo, useState } from 'react'
import { Wallet, Gift, Coins, Trophy, Sprout, Lock } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint } from '@/components/blocks'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { AccountTxn } from '@/lib/types'

const ACCOUNTS = [
  {
    key: '现金本金余额' as const,
    label: '现金本金余额',
    icon: Wallet,
    field: 'cashBalance' as const,
    unit: '元',
    rule: '真实充值本金，可全额申请退款，退款按原路退回微信支付',
    tone: 'text-primary',
  },
  {
    key: '赠送余额' as const,
    label: '赠送余额',
    icon: Gift,
    field: 'giftBalance' as const,
    unit: '元',
    rule: '充值活动赠送部分，仅可消费不可提现、不可退款、不可转让',
    tone: 'text-brand-foreground',
  },
  {
    key: '羽球币' as const,
    label: '羽球币',
    icon: Coins,
    field: 'coins' as const,
    unit: '币',
    rule: '运营活动发放的虚拟币，1币抵1元，仅限本馆场地与商品消费',
    tone: 'text-gold-foreground',
  },
  {
    key: '成人赛事积分' as const,
    label: '成人赛事积分',
    icon: Trophy,
    field: 'eventPoints' as const,
    unit: '分',
    rule: '瑞士制赛事名次积分，只用于排行榜与分级，不可当钱花',
    tone: 'text-primary',
  },
  {
    key: '青少年成长积分' as const,
    label: '青少年成长积分',
    icon: Sprout,
    field: 'growthPoints' as const,
    unit: '分',
    rule: '青少年培训考核成长值，只用于成长档案与晋级，不可当钱花',
    tone: 'text-brand-foreground',
  },
]

export default function MemberWalletPage() {
  const members = useDemoStore((s) => s.members)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const txns = useDemoStore((s) => s.txns)
  const [filter, setFilter] = useState<string>('全部')

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]

  const myTxns = useMemo(
    () =>
      txns
        .filter((t) => t.memberId === me.id)
        .filter((t) => (filter === '全部' ? true : t.account === filter)),
    [txns, me.id, filter],
  )

  const cashTotal = me.cashBalance
  const nonWithdrawable = me.giftBalance + me.coins

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="我的账户 · 五类账户严格分开记账"
        desc="现金本金、赠送余额、羽球币、成人赛事积分、青少年成长积分互相独立，不可互相冲抵；每一笔变动都有明细可追溯。"
        rules={['FR-05 账户隔离', '赠送余额不可提现', '积分不参与支付']}
      />

      <RuleNote title="FR-05 账户隔离口径">
        赠送余额与羽球币<strong>不可提现、不可退款</strong>；现金本金余额可全额退款。积分类账户仅用于排名与晋级，
        任何情况下不参与支付计算，避免财务口径混乱。
      </RuleNote>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACCOUNTS.map((a) => {
          const value = me[a.field]
          const withdrawable = a.key === '现金本金余额'
          return (
            <Card key={a.key} className="gap-0 py-0">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <a.icon className={cn('size-4', a.tone)} aria-hidden />
                    <span className="text-sm font-medium">{a.label}</span>
                  </div>
                  {withdrawable ? (
                    <Badge variant="outline" className="border-brand/40 text-brand-foreground">
                      可退款
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
                      <Lock className="size-3" aria-hidden />
                      {a.key.includes('积分') ? '不可消费' : '不可提现'}
                    </Badge>
                  )}
                </div>
                <p className="font-mono text-3xl font-bold tabular-nums">
                  {value.toLocaleString('zh-CN')}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">{a.unit}</span>
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">{a.rule}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="可退款金额（现金本金）"
          value={cashTotal.toLocaleString('zh-CN')}
          unit="元"
          hint="原路退回微信支付"
          tone="primary"
        />
        <StatCard
          label="不可提现权益合计"
          value={nonWithdrawable.toLocaleString('zh-CN')}
          unit="元"
          hint="赠送余额 + 羽球币"
          tone="gold"
        />
        <StatCard
          label="账户变动明细"
          value={txns.filter((t) => t.memberId === me.id).length}
          unit="条"
          hint="全部可追溯"
        />
      </div>

      <SectionCard
        title="账户变动明细"
        description="每笔变动记录科目、金额、变动后余额与原因，可按账户筛选核对。"
        action={
          <div className="flex flex-wrap gap-1.5">
            {['全部', ...ACCOUNTS.map((a) => a.key)].map((k) => (
              <Button
                key={k}
                size="sm"
                variant={filter === k ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setFilter(k)}
              >
                {k}
              </Button>
            ))}
          </div>
        }
      >
        {myTxns.length === 0 ? (
          <EmptyHint text="该账户暂无变动记录" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>账户科目</TableHead>
                  <TableHead className="text-right">变动</TableHead>
                  <TableHead className="text-right">变动后余额</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>关联订单</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myTxns.map((t: AccountTxn) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{t.at}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{t.account}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono text-sm font-medium tabular-nums',
                        t.delta >= 0 ? 'text-brand-foreground' : 'text-destructive',
                      )}
                    >
                      {t.delta >= 0 ? '+' : ''}
                      {t.delta.toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {t.balanceAfter.toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.reason}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.orderId ?? '—'}</TableCell>
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
