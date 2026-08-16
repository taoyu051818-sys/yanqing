'use client'

import { useMemo, useState } from 'react'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint, FourFactorTags, StatusBadge } from '@/components/blocks'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useDemoStore } from '@/lib/store'
import { round2 } from '@/lib/finance'

const BIZ = ['全部', 'venue', 'event', 'training', 'game', 'goods'] as const
const BIZ_LABEL: Record<string, string> = {
  全部: '全部业务',
  venue: '场地',
  event: '赛事',
  training: '培训',
  game: '球局',
  goods: '商品',
}

export default function AdminOrdersPage() {
  const orders = useDemoStore((s) => s.orders)
  const ledger = useDemoStore((s) => s.ledger)
  const [biz, setBiz] = useState<string>('全部')
  const [q, setQ] = useState('')

  const filteredOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (biz === '全部' || o.businessType === biz) &&
          (q.trim() === '' ||
            o.id.toLowerCase().includes(q.trim().toLowerCase()) ||
            o.memberName.includes(q.trim())),
      ),
    [orders, biz, q],
  )

  const filteredLedger = useMemo(
    () => ledger.filter((l) => biz === '全部' || l.businessType === biz),
    [ledger, biz],
  )

  const paidTotal = round2(
    filteredOrders.filter((o) => o.status !== 'pending' && o.status !== 'refunded').reduce((s, o) => s + o.amount, 0),
  )
  const refundTotal = round2(
    filteredOrders.filter((o) => o.status === 'refunded').reduce((s, o) => s + o.amount, 0),
  )

  return (
    <div>
      <PageIntro
        title="订单与流水 · 四要素全量台账"
        desc="每一笔订单都必须同时具备业务类型、收款主体、支付渠道与来源渠道四个要素，财务流水由订单自动生成，可逐笔追溯到经办人与时间。"
        rules={['FR-01 四要素必填', '流水由订单派生', '退款独立成行']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard label="订单笔数" value={filteredOrders.length} unit="单" tone="primary" />
          <StatCard label="有效收款" value={paidTotal.toLocaleString('zh-CN')} unit="元" tone="brand" />
          <StatCard label="退款金额" value={refundTotal.toLocaleString('zh-CN')} unit="元" />
          <StatCard label="流水条数" value={filteredLedger.length} unit="条" tone="gold" />
        </div>

        <SectionCard
          title="筛选条件"
          description="按业务类型筛选，或按订单号、会员姓名检索，用于财务核对与争议处理。"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="biz-filter">业务类型</Label>
              <Select value={biz} onValueChange={(v) => v && setBiz(v)}>
                <SelectTrigger id="biz-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BIZ.map((b) => (
                    <SelectItem key={b} value={b}>
                      {BIZ_LABEL[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-q">订单号 / 会员姓名</Label>
              <Input
                id="order-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="如 VO2024 或 张思远"
              />
            </div>
          </div>
        </SectionCard>

        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">订单台账</TabsTrigger>
            <TabsTrigger value="ledger">财务流水</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-4">
            <SectionCard title="订单台账" description="展示每单的四要素标签、金额与状态。">
              {filteredOrders.length === 0 ? (
                <EmptyHint text="没有符合条件的订单" />
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredOrders.map((o) => (
                    <div
                      key={o.id}
                      className="flex flex-col gap-2 rounded-xl bg-secondary/50 p-3 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-foreground">{o.id}</span>
                          <StatusBadge status={o.status} />
                          <span className="text-xs text-muted-foreground">{o.memberName}</span>
                        </div>
                        <FourFactorTags
                          businessType={o.businessType}
                          subject={o.subject}
                          payChannel={o.payChannel}
                          sourceChannel={o.sourceChannel}
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {o.title} · {o.createdAt}
                        </span>
                      </div>
                      <span className="font-mono text-sm font-semibold text-foreground lg:text-right">
                        ¥{o.amount.toLocaleString('zh-CN')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="ledger" className="mt-4">
            <SectionCard
              title="财务流水"
              description="业务收款、退款、培训确认收入与「计入球馆流水」分别独立成行，互不覆盖。"
            >
              {filteredLedger.length === 0 ? (
                <EmptyHint text="没有符合条件的流水" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-[11px] text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">时间</th>
                        <th className="py-2 pr-3 font-medium">摘要</th>
                        <th className="py-2 pr-3 font-medium">类型</th>
                        <th className="py-2 pr-3 font-medium">主体</th>
                        <th className="py-2 pr-3 font-medium">渠道</th>
                        <th className="py-2 pr-3 text-right font-medium">金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLedger.map((l) => (
                        <tr key={l.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">{l.at}</td>
                          <td className="py-2 pr-3 text-foreground">{l.title}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.kind}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.subject}</td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {l.payChannel} / {l.sourceChannel}
                          </td>
                          <td
                            className={
                              l.amount < 0
                                ? 'py-2 pr-3 text-right font-mono font-medium text-destructive'
                                : 'py-2 pr-3 text-right font-mono font-medium text-foreground'
                            }
                          >
                            {l.amount < 0 ? '-' : ''}¥{Math.abs(l.amount).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>

        <RuleNote title="四要素为什么必填">
          缺少任一要素，收入就无法归属到正确的经营口径：业务类型决定利润归属，收款主体决定资金归集，支付渠道决定对账通道，来源渠道决定营销投放的真实产出。系统在下单环节即强制校验，不允许事后补录。
        </RuleNote>
      </div>
    </div>
  )
}
