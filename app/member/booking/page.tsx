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
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/link-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldRow, FlowProgress, FourFactorTags, PageIntro, SectionCard } from '@/components/blocks'
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
    const res = createVenueOrder({
      memberId: me.id,
      date,
      courtId: selected,
      slotId,
      amount: price,
      payChannel,
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
    <div className="flex flex-col gap-3">
      <PageIntro
        title="预约订场"
        desc="20 片场地按区域分组呈现，培训占场与已订场次实时置灰。新客体验券仅可用于非黄金时段。"
        rules={['20片场地全量可视化', '体验券不可用于黄金时段', 'FR-01 四要素']}
      />

      {/* 日期横向选择 */}
      <section className="flex flex-col gap-2 rounded-xl bg-card px-3 py-3">
        <span className="text-[13px] font-semibold tracking-tight text-foreground">选择日期</span>
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {DEMO_DATES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDate(d)
                setSelected(null)
              }}
              className={cn(
                'flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-colors',
                d === date ? 'bg-brand text-brand-foreground' : 'bg-secondary text-secondary-foreground',
              )}
            >
              <span className="font-mono text-[11px] leading-none">{d.slice(5)}</span>
              <span className="text-[10px] leading-none opacity-75">{WEEKDAY_LABEL[d]}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 时段横向选择 */}
      <section className="flex flex-col gap-2 rounded-xl bg-card px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold tracking-tight text-foreground">选择时段</span>
          <span className="text-[10px] text-muted-foreground">黄金时段价最高</span>
        </div>
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {slots.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSlotId(s.id)
                setSelected(null)
              }}
              className={cn(
                'flex w-[104px] shrink-0 flex-col gap-1 rounded-xl px-2.5 py-2 text-left transition-colors',
                s.id === slotId ? 'bg-brand/15 ring-1 ring-brand' : 'bg-secondary',
              )}
            >
              <span className="font-mono text-[11px] font-medium leading-none text-foreground">{s.label}</span>
              <span
                className={cn(
                  'w-fit rounded px-1 py-0.5 text-[9px] leading-none',
                  s.period === '黄金时段' ? 'bg-gold/25 text-gold-foreground' : 'bg-card text-muted-foreground',
                )}
              >
                {s.period}
              </span>
              <span className="font-mono text-[10px] leading-none text-muted-foreground">
                {yuan(s.price)}
                {s.period !== '黄金时段' && ` / 券${yuan(s.newbiePrice)}`}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 场地矩阵 */}
      <SectionCard title={`场地矩阵 · ${date.slice(5)} ${slot.label}`}>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-brand" />可预订
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-muted-foreground/40" />已订出
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-gold" />培训占用
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary" />已选中
          </span>
        </div>
        {zones.map((zone) => (
          <div key={zone} className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">{zone}</span>
            <div data-guide="court-grid" className="grid grid-cols-4 gap-1.5">
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
                        'flex flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors',
                        isSel && 'bg-primary text-primary-foreground',
                        !isSel && !disabled && 'bg-brand/12 text-brand-foreground',
                        training && 'cursor-not-allowed bg-gold/18 text-gold-foreground',
                        !training && takenStatus && 'cursor-not-allowed bg-secondary text-muted-foreground',
                      )}
                    >
                      <span className="font-mono text-[11px] font-semibold leading-none">{c.name}</span>
                      <span className="text-[9px] leading-none opacity-80">
                        {training ? '培训' : takenStatus ? '已订' : '可订'}
                      </span>
                    </button>
                  )
                })}
            </div>
          </div>
        ))}
      </SectionCard>

      {/* 下单确认 */}
      <SectionCard title="下单确认" description={`${me.name} · ${me.level}`}>
        <div className="flex flex-col divide-y divide-border/60">
          <FieldRow label="日期时段" value={`${date} ${slot.label}`} mono />
          <FieldRow label="场地" value={selected ? courts.find((c) => c.id === selected)!.name : '未选择'} mono />
          <FieldRow label="时段类型" value={slot.period} />
          <FieldRow label="应付金额" value={yuan(price)} mono />
        </div>

        {myNewbieCoupon ? (
          <button
            type="button"
            onClick={() => couponEligible && setUseCoupon((v) => !v)}
            disabled={!couponEligible}
            className={cn(
              'flex items-start gap-2 rounded-xl p-2.5 text-left transition-colors',
              useCoupon && couponEligible ? 'bg-gold/18 ring-1 ring-gold' : 'bg-secondary/70',
              !couponEligible && 'cursor-not-allowed opacity-60',
            )}
          >
            <Ticket className="mt-0.5 size-4 shrink-0 text-gold-foreground" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[12px] font-medium text-foreground">
                {newbieTemplate?.name ?? '新客体验券'}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{myNewbieCoupon.code}</span>
              <span className="text-[10px] leading-tight text-muted-foreground">
                {couponEligible ? '点击使用，体验价 9.9 元' : '当前为黄金时段，体验券不可用'}
              </span>
            </span>
          </button>
        ) : (
          <Link href="/member/coupons" className="rounded-xl bg-secondary/70 p-2.5 text-[11px] text-muted-foreground">
            还没有新客体验券？前往券包领取 →
          </Link>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">支付渠道</span>
          <Select value={payChannel} onValueChange={(v) => v && setPayChannel(v as PayChannel)}>
            <SelectTrigger size="sm" className="w-full">
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

        <Button disabled={!selected} onClick={() => setConfirmOpen(true)} className="h-10 w-full rounded-xl">
          {selected ? `确认支付 ${yuan(price)}` : '请先选择场地'}
        </Button>
      </SectionCard>

      {paidOrder && (
        <SectionCard title="签到码已生成" description="到场后由员工端扫码核销放行。">
          <div className="flex items-center justify-center gap-2 rounded-xl bg-brand/12 py-4">
            <QrCode className="size-4 text-brand-foreground" />
            <span className="font-mono text-base font-bold tracking-wider text-brand-foreground">
              {paidOrder.qrCode}
            </span>
          </div>
          <div className="flex flex-col divide-y divide-border/60">
            <FieldRow label="订单号" value={paidOrder.id} mono />
            <FieldRow label="内容" value={paidOrder.title} />
            <FieldRow label="金额" value={yuan(paidOrder.amount)} mono />
          </div>
          <LinkButton href="/staff/checkin" size="sm" variant="outline" className="w-full rounded-xl">
            前往员工端核销 →
          </LinkButton>
        </SectionCard>
      )}

      <FlowProgress flow={flowByKey('flow1')} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">确认订单</DialogTitle>
            <DialogDescription className="text-[11px]">模拟支付流程，确认后立即生成签到码。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col divide-y divide-border/60">
            <FieldRow label="场地" value={selected ? courts.find((c) => c.id === selected)!.name : '-'} mono />
            <FieldRow label="时间" value={`${date} ${slot.label}`} mono />
            <FieldRow label="支付渠道" value={payChannel} />
            <FieldRow label="来源渠道" value={useCoupon && couponEligible ? '新客体验券' : '小程序自然流量'} />
            <FieldRow label="金额" value={yuan(price)} mono />
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button className="flex-1 rounded-xl" onClick={submit}>
              确认支付
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
