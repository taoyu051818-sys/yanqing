'use client'

import { useMemo } from 'react'
import { PageIntro, SectionCard, StatCard, RuleNote } from '@/components/blocks'
import { cn } from '@/lib/utils'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'

export default function StaffCourtsPage() {
  const courts = useDemoStore((s) => s.courts)
  const slots = useDemoStore((s) => s.slots)
  const orders = useDemoStore((s) => s.orders)

  /** 场地 × 时段占用矩阵 */
  const occupancy = useMemo(() => {
    const map = new Map<string, { status: string; member: string; orderNo: string }>()
    orders
      .filter((o) => o.businessType === 'venue' && o.date === DEMO_TODAY && o.status !== 'refunded')
      .forEach((o) => {
        if (o.courtId && o.slotId) {
          map.set(`${o.courtId}-${o.slotId}`, {
            status: o.status,
            member: o.memberName,
            orderNo: o.id,
          })
        }
      })
    return map
  }, [orders])

  const totalCells = courts.length * slots.length
  const usedCells = occupancy.size
  const rate = totalCells === 0 ? 0 : Math.round((usedCells / totalCells) * 100)

  const primeSlots = slots.filter((s) => s.period === '黄金时段')
  const primeUsed = courts.reduce(
    (sum, c) => sum + primeSlots.filter((s) => occupancy.has(`${c.id}-${s.id}`)).length,
    0,
  )
  const primeRate =
    primeSlots.length === 0 ? 0 : Math.round((primeUsed / (courts.length * primeSlots.length)) * 100)

  return (
    <div>
      <PageIntro
        title={`场地看板 · ${courts.length}片场地实时状态`}
        desc="按场地 × 时段展示今日占用情况，值班人员据此处理现场调场、拼场与临时锁场。黄金时段单独统计利用率。"
        rules={[`${courts.length}片场地`, `${slots.length}个时段`, '黄金/平峰分级计价']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="今日占用" value={`${usedCells}/${totalCells}`} hint="格位数" tone="primary" />
          <StatCard label="整体利用率" value={rate} unit="%" tone="brand" />
          <StatCard label="黄金时段利用率" value={primeRate} unit="%" hint="18:00 后时段" tone="gold" />
          <StatCard label="待签到订单" value={orders.filter((o) => o.status === 'paid').length} unit="单" />
        </div>

        <SectionCard
          title="占用矩阵"
          description="绿色为已签到入场，蓝色为已支付待签到，灰色为空闲可售。点位显示会员姓名，便于现场核对。"
        >
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-left">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    场地
                  </th>
                  {slots.map((s) => (
                    <th key={s.id} className="px-1 py-1 text-center text-[10px] font-medium text-muted-foreground">
                      <div className="flex flex-col leading-tight">
                        <span className="font-mono">{s.label}</span>
                        <span className={s.period === '黄金时段' ? 'text-gold-foreground' : ''}>{s.period}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courts.map((c) => (
                  <tr key={c.id}>
                    <th className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1 text-[11px] font-medium text-foreground">
                      {c.name}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">{c.zone}</span>
                    </th>
                    {slots.map((s) => {
                      const cell = occupancy.get(`${c.id}-${s.id}`)
                      const tone = !cell
                        ? 'border-border bg-muted/40 text-muted-foreground'
                        : cell.status === 'checked_in' || cell.status === 'completed'
                          ? 'border-brand/40 bg-brand/20 text-brand-foreground'
                          : 'border-primary/25 bg-primary/10 text-primary'
                      return (
                        <td key={s.id} className="p-0">
                          <div
                            className={cn(
                              'flex h-9 min-w-16 flex-col items-center justify-center rounded-md border px-1 text-[10px] leading-tight',
                              tone,
                            )}
                            title={cell ? `${cell.orderNo} · ${cell.member}` : '空闲'}
                          >
                            {cell ? (
                              <>
                                <span className="max-w-full truncate font-medium">{cell.member}</span>
                                <span className="font-mono text-[9px] opacity-70">
                                  {cell.status === 'checked_in' || cell.status === 'completed' ? '已入场' : '待签到'}
                                </span>
                              </>
                            ) : (
                              <span>空闲</span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <RuleNote title="看板与订单的一致性">
          看板数据完全来源于场地订单，已退款订单立即释放格位；任何调场都必须通过订单变更完成，不允许仅在看板上手工标注，确保收入与占用可对账。
        </RuleNote>
      </div>
    </div>
  )
}
