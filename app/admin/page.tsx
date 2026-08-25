'use client'

import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { PageIntro, SectionCard, StatCard, RuleNote, FieldRow } from '@/components/blocks'
import { LinkButton } from '@/components/link-button'
import { Progress } from '@/components/ui/progress'
import { useDemoStore } from '@/lib/store'
import { DEMO_TODAY } from '@/lib/seed'
import { round2 } from '@/lib/finance'

export default function AdminCockpitPage() {
  const ledger = useDemoStore((s) => s.ledger)
  const orders = useDemoStore((s) => s.orders)
  const courts = useDemoStore((s) => s.courts)
  const slots = useDemoStore((s) => s.slots)
  const members = useDemoStore((s) => s.members)
  const merchants = useDemoStore((s) => s.merchants)
  const couponCodes = useDemoStore((s) => s.couponCodes)
  const enrollments = useDemoStore((s) => s.enrollments)

  /** 现金贡献 = 业务收款 − 退款，培训仅计入20%口径部分 */
  const cash = useMemo(() => {
    const income = ledger
      .filter((l) => l.kind === '业务收款' && l.businessType !== 'training')
      .reduce((s, l) => s + l.amount, 0)
    const trainingContrib = ledger
      .filter((l) => l.kind === '计入球馆流水')
      .reduce((s, l) => s + l.amount, 0)
    const refund = ledger.filter((l) => l.kind === '退款').reduce((s, l) => s + Math.abs(l.amount), 0)
    return {
      income: round2(income),
      trainingContrib: round2(trainingContrib),
      refund: round2(refund),
      net: round2(income + trainingContrib - refund),
    }
  }, [ledger])

  /** 场地效率 */
  const venueToday = orders.filter(
    (o) => o.businessType === 'venue' && o.date === DEMO_TODAY && o.status !== 'refunded',
  )
  const capacity = courts.length * slots.length
  const utilization = capacity === 0 ? 0 : Math.round((venueToday.length / capacity) * 100)

  /** 新客漏斗：领券 → 到场 → 复购 */
  const claimed = couponCodes.filter((c) => c.templateId === 'CT01' && c.status !== 'issued').length
  const redeemed = couponCodes.filter((c) => c.templateId === 'CT01' && c.status === 'redeemed').length
  const arrived = orders.filter((o) => o.status === 'checked_in' || o.status === 'completed').length
  const repurchase = members.filter((m) => m.visits30d > 1).length

  const pendingSettle = merchants.filter((m) => m.settlementStatus !== '已结算').length
  const activeEnroll = enrollments.filter((e) => e.status === '在读').length

  const funnel = [
    { label: '体验券领取', value: claimed, base: Math.max(claimed, 1) },
    { label: '到场核销', value: Math.max(redeemed, arrived), base: Math.max(claimed, 1) },
    { label: '产生复购', value: repurchase, base: Math.max(claimed, 1) },
  ]

  return (
    <div>
      <PageIntro
        title="经营驾驶舱 · 老板视角"
        desc="以现金贡献为第一指标，场地效率为第二指标，配合新客漏斗与待办风险项。培训收入仅按合同口径的 20% 计入球馆流水，避免虚增。"
        rules={['现金贡献口径', '培训20%口径', '数据来源为全量流水']}
      >
        <LinkButton href="/admin/orders" size="sm" variant="outline">
          查看全量流水
        </LinkButton>
      </PageIntro>

      <div className="flex flex-col gap-5">
        <div data-guide="admin-kpis" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard
            label="现金贡献净额"
            value={cash.net.toLocaleString('zh-CN')}
            unit="元"
            hint="含培训20%口径，已扣退款"
            tone="primary"
          />
          <StatCard label="场地利用率" value={utilization} unit="%" hint={`${venueToday.length}/${capacity} 格位`} tone="brand" />
          <StatCard label="培训计入流水" value={cash.trainingContrib.toLocaleString('zh-CN')} unit="元" hint="有效流水×20%" tone="gold" />
          <StatCard label="累计退款" value={cash.refund.toLocaleString('zh-CN')} unit="元" hint="原路退回" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard
              title="新客转化漏斗"
              description="从体验券领取到首次到场，再到产生复购，衡量新客体验闭环的真实转化效率。"
            >
              <div className="flex flex-col gap-4">
                {funnel.map((f) => {
                  const pct = Math.round((f.value / f.base) * 100)
                  return (
                    <div key={f.label} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">{f.label}</span>
                        <span className="font-mono text-muted-foreground">
                          {f.value} 人 · {pct}%
                        </span>
                      </div>
                      <Progress value={Math.min(pct, 100)} className="h-2" />
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="风险与待办" description="需要老板或财务介入处理的事项。">
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-foreground" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-foreground">{pendingSettle} 个商户待结算</span>
                  <span className="text-[11px] text-muted-foreground">联盟券归因成交需完成对账</span>
                </div>
              </div>
              <div className="flex flex-col">
                <FieldRow label="在读学员" value={`${activeEnroll} 人`} mono />
                <FieldRow label="待支付订单" value={`${orders.filter((o) => o.status === 'pending').length} 单`} mono />
                <FieldRow label="待签到订单" value={`${orders.filter((o) => o.status === 'paid').length} 单`} mono />
                <FieldRow label="会员总数" value={`${members.length} 人`} mono />
              </div>
              <div className="flex flex-wrap gap-2">
                <LinkButton href="/admin/alliance" size="sm" variant="outline">
                  联盟对账
                </LinkButton>
                <LinkButton href="/admin/training" size="sm" variant="outline">
                  培训核算
                </LinkButton>
              </div>
            </div>
          </SectionCard>
        </div>

        <RuleNote title="现金贡献的计算口径">
          现金贡献 = 场地/赛事/球局/商品业务收款 + 培训有效流水×20% − 全部退款。培训剩余 80% 属合同约定的教练方收入，不计入球馆流水；赠送余额、羽球币与各类积分均不计入现金贡献。
        </RuleNote>
      </div>
    </div>
  )
}
