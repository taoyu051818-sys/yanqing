'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { QrCode, Ticket } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { flowByKey } from '@/lib/flows'
import { isTrainingOccupied, yuan } from '@/lib/finance'
import { DEMO_DATES, WEEKDAY_LABEL } from '@/lib/seed'
import type { PayChannel, SourceChannel } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/link-button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldRow, FlowProgress, FourFactorTags, PageIntro } from '@/components/blocks'
import { cn } from '@/lib/utils'

export default function BookingPage() {
  const courts = useDemoStore((s) => s.courts)
  const slots = useDemoStore((s) => s.slots)
  const orders = useDemoStore((s) => s.orders)
  const members = useDemoStore((s) => s.members)
  const couponCodes = useDemoStore((s) => s.couponCodes)
  const couponTemplates = useDemoStore((s) => s.couponTemplates)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const createVenueOrder = useDemoStore((s) => s.createVenueOrder)
  const payOrder = useDemoStore((s) => s.payOrder)

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]
  const [date, setDate] = useState(DEMO_DATES[0])
  const [slotId, setSlotId] = useState(slots[0]?.id ?? 'S1')
  const [selected, setSelected] = useState<string | null>(null)
  const [useCoupon, setUseCoupon] = useState(false)
  const [payChannel, setPayChannel] = useState<PayChannel>('微信支付')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null)

  const slot = slots.find((s) => s.id === slotId)!
  const myNewbieCoupon = couponCodes.find(
    (c) => c.templateId === 'CT01' && c.memberId === me.id && c.status === 'claimed',
  )
  const newbieTemplate = couponTemplates.find((t) => t.id === 'CT01')

  const booked = useMemo(() => {
    const map = new Map<string, string>()
    orders
      .filter(
        (o) =>
          o.businessType === 'venue' &&
          o.date === date &&
          o.slotId === slotId &&
          o.status !== 'refunded' &&
          o.status !== 'cancelled',
      )
      .forEach((o) => map.set(o.courtId!, o.status))
    return map
  }, [orders, date, slotId])

  const couponEligible = Boolean(myNewbieCoupon) && slot.period !== '黄金时段'
  const price = useCoupon && couponEligible ? slot.newbiePrice : slot.price
  const paidOrder = orders.find((o) => o.id === paidOrderId)

  const zones = ['东区', '西区', '南区', '北区'] as const

  const submit = () => {
    if (!selected) return
    const sourceChannel: SourceChannel = useCoupon && couponEligible ? '新客体验券' : '小程序自然流量'
    const channel: PayChannel = useCoupon && couponEligible && price === 9.9 ? payChannel : payChannel
    const res = createVenueOrder({
      memberId: me.id,
      date,
      courtId: selected,
      slotId,
      amount: price,
      payChannel: channel,
      sourceChannel,
      couponCode: useCoupon && couponEligible ? myNewbieCoupon!.code : undefined,
    })
    if (!res.ok || !res.id) {
      toast.error(res.message)
      return
    }
    const pay = payOrder(res.id)
    if (!pay.ok) {
      toast.error(pay.message)
      return
    }
    setPaidOrderId(res.id)
    setConfirmOpen(false)
    setSelected(null)
    setUseCoupon(false)
    toast.success('支付成功，签到码已生成')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="预约订场"
        desc="20 片场地按区域分组呈现，培训占场与已订场次实时置灰。新客体验券仅可用于非黄金时段。"
        rules={['20片场地全量可视化', '体验券不可用于黄金时段', '订单绑定四要素（FR-01）']}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">选择日期与时段</CardTitle>
              <p className="text-xs text-muted-foreground">黄金时段价格最高，早场与日场适合体验券核销。</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {DEMO_DATES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDate(d)
                      setSelected(null)
                    }}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2 transition-colors',
                      d === date
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:border-primary/40',
                    )}
                  >
                    <span className="font-mono text-xs">{d.slice(5)}</span>
                    <span className="text-[10px] opacity-80">{WEEKDAY_LABEL[d]}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSlotId(s.id)
                      setSelected(null)
                    }}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors',
                      s.id === slotId
                        ? 'border-primary bg-primary/[0.06]'
                        : 'border-border bg-card hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium">{s.label}</span>
                      <Badge
                        variant={s.period === '黄金时段' ? 'default' : 'secondary'}
                        className="rounded-sm text-[10px]"
                      >
                        {s.period}
                      </Badge>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {yuan(s.price)}
                      {s.period !== '黄金时段' && ` · 体验价 ${yuan(s.newbiePrice)}`}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">
                场地矩阵 · {date.slice(5)} {slot.label}
              </CardTitle>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-brand" />
                  可预订
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-muted-foreground/40" />
                  已订出
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-gold" />
                  培训占用
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-primary" />
                  已选中
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {zones.map((zone) => (
                <div key={zone} className="flex flex-col gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {zone}
                  </span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {courts
                      .filter((c) => c.zone === zone)
                      .map((c) => {
                        const training = isTrainingOccupied(c.id, slotId)
                        const takenStatus = booked.get(c.id)
                        const disabled = training || Boolean(takenStatus)
                        const isSel = selected === c.id
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => setSelected(c.id)}
                            className={cn(
                              'flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                              isSel && 'border-primary bg-primary text-primary-foreground',
                              !isSel && !disabled && 'border-brand/40 bg-brand/10 hover:border-brand',
                              training && 'cursor-not-allowed border-gold/40 bg-gold/15 text-gold-foreground',
                              !training && takenStatus && 'cursor-not-allowed border-border bg-muted text-muted-foreground',
                            )}
                          >
                            <span className="font-mono text-xs font-semibold">{c.name}</span>
                            <span className="text-[10px] leading-tight opacity-80">
                              {training ? '培训占用' : takenStatus ? '已订出' : c.usage}
                            </span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <FlowProgress flow={flowByKey('flow1')} />

          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">下单确认</CardTitle>
              <p className="text-xs text-muted-foreground">{me.name} · {me.level}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col">
                <FieldRow label="日期时段" value={`${date} ${slot.label}`} mono />
                <FieldRow
                  label="场地"
                  value={selected ? courts.find((c) => c.id === selected)!.name : '未选择'}
                  mono
                />
                <FieldRow label="时段类型" value={slot.period} />
                <FieldRow label="应付金额" value={yuan(price)} mono />
              </div>

              {myNewbieCoupon ? (
                <button
                  type="button"
                  onClick={() => couponEligible && setUseCoupon((v) => !v)}
                  disabled={!couponEligible}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                    useCoupon && couponEligible
                      ? 'border-gold bg-gold/15'
                      : 'border-border bg-card hover:border-gold/50',
                    !couponEligible && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Ticket className="mt-0.5 size-4 shrink-0 text-gold-foreground" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium">{newbieTemplate?.name ?? '新客体验券'}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{myNewbieCoupon.code}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {couponEligible ? '点击使用，体验价 9.9 元' : '当前为黄金时段，体验券不可用'}
                    </span>
                  </span>
                </button>
              ) : (
                <Link
                  href="/member/coupons"
                  className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground transition-colors hover:border-gold/50"
                >
                  还没有新客体验券？前往券包领取 →
                </Link>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">支付渠道</span>
                <Select value={payChannel} onValueChange={(v) => v && setPayChannel(v as PayChannel)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="微信支付">微信支付</SelectItem>
                    <SelectItem value="现金余额">现金余额（{yuan(me.cashBalance)}）</SelectItem>
                    <SelectItem value="赠送余额">赠送余额（{yuan(me.giftBalance)}）</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <FourFactorTags
                businessType="venue"
                subject="球馆本部"
                payChannel={payChannel}
                sourceChannel={useCoupon && couponEligible ? '新客体验券' : '小程序自然流量'}
              />

              <Button disabled={!selected} onClick={() => setConfirmOpen(true)} className="w-full">
                {selected ? `确认支付 ${yuan(price)}` : '请先选择场地'}
              </Button>
            </CardContent>
          </Card>

          {paidOrder && (
            <Card className="border-brand/40 bg-brand/[0.06]">
              <CardHeader className="gap-1">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <QrCode className="size-4" />
                  签到码已生成
                </CardTitle>
                <p className="text-xs text-muted-foreground">到场后由员工端扫码核销放行。</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-center rounded-lg border border-brand/40 bg-card p-4">
                  <span className="font-mono text-lg font-bold tracking-wider">{paidOrder.qrCode}</span>
                </div>
                <div className="flex flex-col">
                  <FieldRow label="订单号" value={paidOrder.id} mono />
                  <FieldRow label="内容" value={paidOrder.title} />
                  <FieldRow label="金额" value={yuan(paidOrder.amount)} mono />
                </div>
                <LinkButton href="/staff/checkin" size="sm" variant="outline">
                  前往员工端核销 →
                </LinkButton>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认订单</DialogTitle>
            <DialogDescription>模拟支付流程，确认后立即生成签到码。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col">
            <FieldRow label="场地" value={selected ? courts.find((c) => c.id === selected)!.name : '-'} mono />
            <FieldRow label="时间" value={`${date} ${slot.label}`} mono />
            <FieldRow label="支付渠道" value={payChannel} />
            <FieldRow label="来源渠道" value={useCoupon && couponEligible ? '新客体验券' : '小程序自然流量'} />
            <FieldRow label="金额" value={yuan(price)} mono />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button onClick={submit}>确认支付</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
