'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ScanLine, CheckCircle2, RotateCcw } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, StatusBadge, FieldRow, EmptyHint, FlowProgress } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DEMO_TODAY } from '@/lib/seed'

const OPERATOR = '前台-李婷'

export default function StaffCheckinPage() {
  const orders = useDemoStore((s) => s.orders)
  const courts = useDemoStore((s) => s.courts)
  const slots = useDemoStore((s) => s.slots)
  const checkInOrder = useDemoStore((s) => s.checkInOrder)
  const refundVenueOrder = useDemoStore((s) => s.refundVenueOrder)

  const [code, setCode] = useState('')
  const [lastId, setLastId] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<string | null>(null)
  const [refundReason, setRefundReason] = useState('会员临时有事，提前2小时申请取消')

  const todayVenue = useMemo(
    () =>
      orders.filter(
        (o) => o.businessType === 'venue' && o.date === DEMO_TODAY && o.status !== 'pending' && o.status !== 'cancelled',
      ),
    [orders],
  )
  const waiting = todayVenue.filter((o) => o.status === 'paid')
  const done = todayVenue.filter((o) => o.status === 'checked_in' || o.status === 'completed')
  const lastOrder = todayVenue.find((o) => o.id === lastId) ?? null
  const refundOrder = orders.find((o) => o.id === refundTarget) ?? null

  const describe = (courtId?: string, slotId?: string) =>
    `${courts.find((c) => c.id === courtId)?.name ?? '—'} · ${slots.find((s) => s.id === slotId)?.label ?? '—'}`

  const handleScan = (raw?: string) => {
    const value = (raw ?? code).trim()
    if (!value) {
      toast.error('请输入或扫描会员出示的签到码')
      return
    }
    const target = orders.find((o) => o.qrCode?.toUpperCase() === value.toUpperCase())
    if (!target) {
      toast.error(`签到码 ${value} 不存在，请核对会员小程序订单`)
      return
    }
    const res = checkInOrder(target.id, OPERATOR)
    if (res.ok) {
      toast.success(res.message)
      setLastId(target.id)
      setCode('')
    } else {
      toast.error(res.message)
    }
  }

  const handleRefund = () => {
    if (!refundOrder) return
    const res = refundVenueOrder(refundOrder.id, OPERATOR, refundReason)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
    setRefundTarget(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="订场核销台"
        desc="会员到场出示签到码，前台扫码核销后订单进入「已签到」。已签到订单不可重复核销，退款需登记原因并原路退回。"
        rules={['一码一单', '重复核销拦截', '退款登记操作人与原因']}
      />

      <FlowProgress flow={FLOWS[0]} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label="今日待核销" value={waiting.length} unit="单" tone="gold" />
        <StatCard label="今日已核销" value={done.length} unit="单" tone="brand" />
        <StatCard label="核销操作人" value={OPERATOR} hint="所有操作写入审计日志" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard
          title="待核销订单"
          description="点击「核销入场」即完成签到，等同前台扫码；重复核销会被系统拦截。"
        >
          {waiting.length === 0 ? (
            <EmptyHint text="今日所有订单已核销完毕" />
          ) : (
            <ul className="flex flex-col gap-2">
              {waiting.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {o.memberName} · {describe(o.courtId, o.slotId)}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {o.id} · 签到码 {o.qrCode} · ¥{o.amount} · {o.payChannel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {o.sourceChannel}
                    </Badge>
                    <Button size="sm" onClick={() => handleScan(o.qrCode)}>
                      <ScanLine className="size-3.5" />
                      核销入场
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRefundTarget(o.id)}>
                      <RotateCcw className="size-3.5" />
                      退款
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard title="手动输码核销" description="会员截图或网络异常时，前台手动输入 6 位签到码。">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qr">签到码</Label>
                <Input
                  id="qr"
                  value={code}
                  placeholder="如 QR7781"
                  className="font-mono uppercase"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleScan()
                  }}
                />
              </div>
              <Button data-guide="checkin-action" onClick={() => handleScan()}>
                <ScanLine className="size-4" />
                确认核销
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                提示：可直接复制右侧待核销列表中的签到码进行测试，重复输入同一码会提示已核销。
              </p>
            </div>
          </SectionCard>

          {lastOrder && (
            <SectionCard title="最近一次核销结果" description="核销后订单状态、入场时间与操作人即时留痕。">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-3 py-2">
                  <CheckCircle2 className="size-4 text-brand-foreground" aria-hidden />
                  <span className="text-xs font-medium text-brand-foreground">核销成功，可放行入场</span>
                </div>
                <div className="flex flex-col">
                  <FieldRow label="订单号" value={lastOrder.id} mono />
                  <FieldRow label="会员" value={lastOrder.memberName} />
                  <FieldRow label="场地时段" value={describe(lastOrder.courtId, lastOrder.slotId)} />
                  <FieldRow label="入场时间" value={lastOrder.checkedInAt ?? '—'} mono />
                  <FieldRow label="订单状态" value={<StatusBadge status={lastOrder.status} />} />
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <SectionCard title="今日已核销记录" description="已核销订单确认为有效收入，进入经营看板的现金贡献统计。">
        {done.length === 0 ? (
          <EmptyHint text="今日暂无已核销记录" />
        ) : (
          <ul className="flex flex-col gap-2">
            {done.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/40 px-3 py-2"
              >
                <span className="text-sm">
                  {o.memberName} · {describe(o.courtId, o.slotId)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">入场 {o.checkedInAt ?? '—'}</span>
                  <StatusBadge status={o.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog open={Boolean(refundTarget)} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记退款</DialogTitle>
            <DialogDescription>
              退款金额按订单实付金额原路退回，赠送余额与羽球币支付部分不予退现，仅退回原账户。
            </DialogDescription>
          </DialogHeader>
          {refundOrder && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col">
                <FieldRow label="订单号" value={refundOrder.id} mono />
                <FieldRow label="会员" value={refundOrder.memberName} />
                <FieldRow label="实付金额" value={`¥${refundOrder.amount}`} mono />
                <FieldRow label="支付渠道" value={refundOrder.payChannel} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reason">退款原因（必填，写入审计日志）</Label>
                <Textarea id="reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>
              取消
            </Button>
            <Button onClick={handleRefund} disabled={!refundReason.trim()}>
              确认退款
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
