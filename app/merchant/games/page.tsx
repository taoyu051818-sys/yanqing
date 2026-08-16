'use client'

import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint, StatusBadge } from '@/components/blocks'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { FieldRow } from '@/components/blocks'
import { useDemoStore } from '@/lib/store'

export default function MerchantGamesPage() {
  const games = useDemoStore((s) => s.games)
  const merchants = useDemoStore((s) => s.merchants)
  const currentMerchantId = useDemoStore((s) => s.currentMerchantId)
  const merchant = merchants.find((m) => m.id === currentMerchantId) ?? merchants[0]

  /** 演示中主理人以商户名义开局 */
  const mine = games.filter((g) => g.host === merchant?.name || g.host.includes('主理人'))

  const revenue = mine.reduce((s, g) => s + g.fee * g.joined, 0)
  const reward = mine.reduce((s, g) => s + g.hostReward, 0)
  const filled = mine.reduce((s, g) => s + g.joined, 0)
  const seats = mine.reduce((s, g) => s + g.capacity, 0)

  return (
    <div>
      <PageIntro
        title="我的球局 · 开局与收益"
        desc="主理人先向球馆购买场地时段，再自主定价开局收人。球局报名收入与场地采购成本分开记账，成局后按规则发放主理人奖励。"
        rules={['场地采购与球局收款分离', '奖励以羽球币发放', '成局后结算']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="我的球局" value={mine.length} unit="场" tone="primary" />
          <StatCard label="报名席位" value={`${filled}/${seats}`} hint="已报名 / 总席位" tone="brand" />
          <StatCard label="球局收款" value={revenue.toLocaleString('zh-CN')} unit="元" />
          <StatCard label="主理人奖励" value={reward.toLocaleString('zh-CN')} unit="羽球币" tone="gold" />
        </div>

        <SectionCard
          title="球局明细"
          description="每场球局的席位进度、收款金额与奖励状态。报名人次不足时按规则不成局，奖励不予发放。"
        >
          {mine.length === 0 ? (
            <EmptyHint text="当前商户暂无球局记录" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {mine.map((g) => {
                const pct = Math.round((g.joined / g.capacity) * 100)
                return (
                  <div key={g.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-foreground">{g.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {g.date} · {g.slot} · {g.courtNames.join('、')}
                        </span>
                      </div>
                      <StatusBadge status={g.status} />
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="rounded-sm text-[10px]">
                        {g.level}
                      </Badge>
                      <Badge variant="outline" className="rounded-sm text-[10px]">
                        ¥{g.fee}/人
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          席位 {g.joined}/{g.capacity}
                        </span>
                        <span className="font-mono">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>

                    <div className="flex flex-col">
                      <FieldRow label="球局收款" value={`¥${(g.fee * g.joined).toLocaleString('zh-CN')}`} mono />
                      <FieldRow label="主理人奖励" value={`${g.hostReward} 羽球币`} mono />
                      <FieldRow
                        label="奖励状态"
                        value={g.status === '已结束' ? '已发放' : g.status === '已满' ? '待成局结算' : '待成局'}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        <RuleNote title="主理人结算口径">
          球局收款属「球局」业务类型，场地时段采购属「场地」业务类型，二者在财务流水中独立成行。主理人奖励为羽球币等权益，不可提现、不进入现金流水，避免虚增经营收入。
        </RuleNote>
      </div>
    </div>
  )
}
