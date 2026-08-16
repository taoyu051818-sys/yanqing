'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useDemoStore } from '@/lib/store'
import { yuan } from '@/lib/finance'
import type { BusinessType } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyHint, FieldRow, FourFactorTags, PageIntro, StatusBadge } from '@/components/blocks'

const TABS: { key: string; label: string; types?: BusinessType[] }[] = [
  { key: 'all', label: '全部' },
  { key: 'venue', label: '场地', types: ['venue'] },
  { key: 'event', label: '赛事', types: ['event'] },
  { key: 'training', label: '培训', types: ['training'] },
  { key: 'other', label: '球局与商品', types: ['game', 'goods'] },
]

export default function MemberOrdersPage() {
  const members = useDemoStore((s) => s.members)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const orders = useDemoStore((s) => s.orders)
  const payOrder = useDemoStore((s) => s.payOrder)
  const refundVenueOrder = useDemoStore((s) => s.refundVenueOrder)
  const [refundId, setRefundId] = useState<string | null>(null)

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]
  const mine = orders.filter((o) => o.memberId === me.id)
  const refundTarget = mine.find((o) => o.id === refundId)

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="我的订单"
        desc="每笔订单都完整记录业务类型、收款主体、支付渠道与来源渠道，便于后台按四要素对账。"
        rules={['FR-01 四要素绑定', '签到后不可退款', '退款回写来源渠道']}
      />

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">
            {me.name} 的订单 · 共 {mine.length} 笔
          </CardTitle>
          <p className="text-xs text-muted-foreground">待支付订单可继续支付，未签到的场地订单支持模拟退款。</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((t) => {
              const list = t.types ? mine.filter((o) => t.types!.includes(o.businessType)) : mine
              return (
                <TabsContent key={t.key} value={t.key} className="flex flex-col gap-2 pt-3">
                  {list.length === 0 && <EmptyHint text="该分类下暂无订单" />}
                  {list.map((o) => (
                    <div key={o.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {o.title}
                            <StatusBadge status={o.status} />
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {o.id} · 下单 {o.createdAt}
                            {o.date && ` · 用场 ${o.date}`}
                          </span>
                        </div>
                        <span className="font-mono text-base font-semibold">{yuan(o.amount)}</span>
                      </div>

                      <FourFactorTags
                        businessType={o.businessType}
                        subject={o.subject}
                        payChannel={o.payChannel}
                        sourceChannel={o.sourceChannel}
                      />

                      {o.qrCode && (o.status === 'paid' || o.status === 'checked_in') && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/60 px-3 py-2">
                          <span className="text-[11px] text-muted-foreground">签到码</span>
                          <span className="font-mono text-sm font-bold tracking-wider">{o.qrCode}</span>
                          {o.checkedInAt && (
                            <span className="text-[11px] text-brand-foreground">已于 {o.checkedInAt} 签到</span>
                          )}
                        </div>
                      )}

                      {o.refundedAt && (
                        <span className="text-[11px] text-destructive">
                          已退款 {yuan(o.refundAmount ?? 0)} · {o.refundedAt}
                          {o.note && ` · ${o.note}`}
                        </span>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {o.status === 'pending' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const res = payOrder(o.id)
                              if (res.ok) toast.success(res.message)
                              else toast.error(res.message)
                            }}
                          >
                            继续支付
                          </Button>
                        )}
                        {o.businessType === 'venue' && o.status === 'paid' && (
                          <Button size="sm" variant="outline" onClick={() => setRefundId(o.id)}>
                            申请退款
                          </Button>
                        )}
                        {o.status === 'checked_in' && (
                          <span className="text-[11px] text-muted-foreground">已签到订单不可退款</span>
                        )}
                      </div>
                    </div>
                  ))}
                </TabsContent>
              )
            })}
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(refundId)} onOpenChange={(v) => !v && setRefundId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>申请退款</DialogTitle>
            <DialogDescription>
              退款将原路退回支付渠道，并在后台生成退款流水与来源渠道回写记录。
            </DialogDescription>
          </DialogHeader>
          {refundTarget && (
            <div className="flex flex-col">
              <FieldRow label="订单" value={refundTarget.title} />
              <FieldRow label="订单号" value={refundTarget.id} mono />
              <FieldRow label="退款金额" value={yuan(refundTarget.amount)} mono />
              <FieldRow label="退回渠道" value={refundTarget.payChannel} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!refundId) return
                const res = refundVenueOrder(refundId, me.name, '会员自助申请退款')
                if (res.ok) toast.success(res.message)
                else toast.error(res.message)
                setRefundId(null)
              }}
            >
              确认退款
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
