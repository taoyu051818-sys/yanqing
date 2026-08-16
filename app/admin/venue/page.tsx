'use client'

import { useMemo } from 'react'
import { PageIntro, SectionCard, StatCard, RuleNote } from '@/components/blocks'
import { Progress } from '@/components/ui/progress'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'
import { round2 } from '@/lib/finance'

export default function AdminVenuePage() {
  const courts = useDemoStore((s) => s.courts)
  const slots = useDemoStore((s) => s.slots)
  const orders = useDemoStore((s) => s.orders)

  const venueOrders = useMemo(
    () => orders.filter((o) => o.businessType === 'venue' && o.status !== 'refunded'),
    [orders],
  )

  /** 按时段统计：售出格位、收入、利用率 */
  const bySlot = useMemo(
    () =>
      slots.map((s) => {
        const sold = venueOrders.filter((o) => o.slotId === s.id && o.date === DEMO_TODAY).length
        const revenue = round2(
          venueOrders.filter((o) => o.slotId === s.id && o.date === DEMO_TODAY).reduce((sum, o) => sum + o.amount, 0),
        )
        return {
          ...s,
          sold,
          revenue,
          rate: Math.round((sold / courts.length) * 100),
        }
      }),
    [slots, venueOrders, courts.length],
  )

  /** 按区域统计 */
  const byZone = useMemo(() => {
    const zones = Array.from(new Set(courts.map((c) => c.zone)))
    return zones.map((z) => {
      const ids = courts.filter((c) => c.zone === z).map((c) => c.id)
      const sold = venueOrders.filter((o) => o.courtId && ids.includes(o.courtId) && o.date === DEMO_TODAY).length
      return {
        zone: z,
        courts: ids.length,
        sold,
        rate: Math.round((sold / (ids.length * slots.length)) * 100),
      }
    })
  }, [courts, venueOrders, slots.length])

  const totalRevenue = round2(bySlot.reduce((s, x) => s + x.revenue, 0))
  const primeRevenue = round2(
    bySlot.filter((s) => s.period === '黄金时段').reduce((s2, x) => s2 + x.revenue, 0),
  )
  const primeShare = totalRevenue === 0 ? 0 : Math.round((primeRevenue / totalRevenue) * 100)

  return (
    <div>
      <PageIntro
        title="场地经营 · 时段结构与利用率"
        desc="以时段为单位分析售出格位、收入与利用率，识别黄金时段是否被低价占用、平峰时段是否需要促销，为定价参数调整提供依据。"
        rules={[`${courts.length}片场地 × ${slots.length}时段`, '分时定价', '新客特价单独口径']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="今日场地收入" value={totalRevenue.toLocaleString('zh-CN')} unit="元" tone="primary" />
          <StatCard label="黄金时段收入" value={primeRevenue.toLocaleString('zh-CN')} unit="元" tone="gold" />
          <StatCard label="黄金时段占比" value={primeShare} unit="%" hint="收入结构健康度" tone="brand" />
          <StatCard
            label="总售出格位"
            value={bySlot.reduce((s, x) => s + x.sold, 0)}
            unit={`/${courts.length * slots.length}`}
          />
        </div>

        <SectionCard
          title="时段结构分析"
          description="标准价与新客特价并列展示，便于判断特价是否侵蚀黄金时段收入。"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">时段</th>
                  <th className="py-2 pr-3 font-medium">分级</th>
                  <th className="py-2 pr-3 text-right font-medium">标准价</th>
                  <th className="py-2 pr-3 text-right font-medium">新客特价</th>
                  <th className="py-2 pr-3 text-right font-medium">售出</th>
                  <th className="py-2 pr-3 text-right font-medium">收入</th>
                  <th className="py-2 pl-3 font-medium">利用率</th>
                </tr>
              </thead>
              <tbody>
                {bySlot.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 font-mono font-medium text-foreground">{s.label}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          s.period === '黄金时段' ? 'font-medium text-gold-foreground' : 'text-muted-foreground'
                        }
                      >
                        {s.period}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-muted-foreground">¥{s.price}</td>
                    <td className="py-2 pr-3 text-right font-mono text-muted-foreground">¥{s.newbiePrice}</td>
                    <td className="py-2 pr-3 text-right font-mono text-foreground">
                      {s.sold}/{courts.length}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-medium text-foreground">
                      ¥{s.revenue.toLocaleString('zh-CN')}
                    </td>
                    <td className="w-32 py-2 pl-3">
                      <div className="flex items-center gap-2">
                        <Progress value={s.rate} className="h-1.5 flex-1" />
                        <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                          {s.rate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="分区利用率" description="按场地分区查看今日整体售出情况，辅助排布主力区域与训练区域。">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byZone.map((z) => (
              <div key={z.zone} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{z.zone}</span>
                  <span className="font-mono text-xs text-muted-foreground">{z.courts} 片</span>
                </div>
                <Progress value={z.rate} className="h-2" />
                <span className="text-[11px] text-muted-foreground">
                  售出 {z.sold} 格位 · 利用率 {z.rate}%
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        <RuleNote title="定价调整的约束">
          新客特价仅对首次到场会员生效且每人限一次，避免长期占用黄金时段。价格参数调整需在参数中心设置生效日期，历史订单按下单时的价格版本结算，不做追溯重算。
        </RuleNote>
      </div>
    </div>
  )
}
