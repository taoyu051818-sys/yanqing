'use client'

import { useMemo, useState } from 'react'
import { Users, Trophy, Wallet } from 'lucide-react'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint, StatusBadge } from '@/components/blocks'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDemoStore } from '@/lib/store'

const LEVELS = ['全部', '初级', '中级', '高级', '混合'] as const

export default function MemberGamesPage() {
  const games = useDemoStore((s) => s.games)
  const [level, setLevel] = useState<string>('全部')

  const list = useMemo(
    () => (level === '全部' ? games : games.filter((g) => g.level === level)),
    [games, level],
  )

  const openCount = games.filter((g) => g.status === '报名中').length
  const totalSeats = games.reduce((sum, g) => sum + g.capacity, 0)
  const joinedSeats = games.reduce((sum, g) => sum + g.joined, 0)

  return (
    <div>
      <PageIntro
        title="球局广场 · 主理人开局与拼场"
        desc="主理人向球馆购买场地时段后自主定价开局，会员按人次报名拼场。球局收款与场地收款分别记账，主理人奖励按成局结算。"
        rules={['球局为独立业务类型', '场地成本与球局收入分开入账', '主理人奖励成局后发放']}
      >
        <Select value={level} onValueChange={(v) => v && setLevel(v)}>
          <SelectTrigger className="w-36" aria-label="按水平筛选球局">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageIntro>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatCard label="可报名球局" value={openCount} unit="场" hint="今日与近期开放" tone="primary" />
          <StatCard
            label="拼场席位"
            value={`${joinedSeats}/${totalSeats}`}
            hint="已报名 / 总席位"
            tone="brand"
          />
          <StatCard
            label="主理人奖励池"
            value={games.reduce((s, g) => s + g.hostReward, 0).toLocaleString('zh-CN')}
            unit="羽球币"
            tone="gold"
          />
        </div>

        <SectionCard
          title="开放中的球局"
          description="报名成功后生成球局订单，四要素中业务类型记为「球局」，与场地订单严格区分。"
        >
          {list.length === 0 ? (
            <EmptyHint text="该水平暂无开放球局" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((g) => {
                const pct = Math.round((g.joined / g.capacity) * 100)
                return (
                  <div key={g.id} className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
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
                        水平 {g.level}
                      </Badge>
                      <Badge variant="outline" className="rounded-sm text-[10px]">
                        主理人 {g.host}
                      </Badge>
                      <Badge variant="outline" className="rounded-sm text-[10px]">
                        ¥{g.fee}/人
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" />
                          {g.joined}/{g.capacity} 人
                        </span>
                        <span className="font-mono">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>

                    <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Wallet className="size-3" />
                        球局收款 ¥{(g.fee * g.joined).toLocaleString('zh-CN')}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Trophy className="size-3" />
                        主理人奖励 {g.hostReward} 羽球币
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        <RuleNote title="球局与场地的记账边界">
          主理人购买场地时段属于「场地」业务收款，会员报名球局属于「球局」业务收款，两者不合并、不互相冲抵。主理人奖励以羽球币发放，属不可提现权益，不进入现金流水。
        </RuleNote>
      </div>
    </div>
  )
}
