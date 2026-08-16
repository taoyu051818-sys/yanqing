'use client'

import { toast } from 'sonner'
import { Ticket } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { flowByKey } from '@/lib/flows'
import { yuan } from '@/lib/finance'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/link-button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyHint, FieldRow, FlowProgress, PageIntro, StatusBadge } from '@/components/blocks'
import { cn } from '@/lib/utils'

export default function MemberCouponsPage() {
  const members = useDemoStore((s) => s.members)
  const currentMemberId = useDemoStore((s) => s.currentMemberId)
  const templates = useDemoStore((s) => s.couponTemplates)
  const codes = useDemoStore((s) => s.couponCodes)
  const merchants = useDemoStore((s) => s.merchants)
  const claimNewbie = useDemoStore((s) => s.claimNewbieCoupon)
  const claimFromTemplate = useDemoStore((s) => s.claimCouponFromTemplate)

  const me = members.find((m) => m.id === currentMemberId) ?? members[0]
  const mine = codes.filter((c) => c.memberId === me.id)
  const available = mine.filter((c) => c.status === 'claimed')
  const used = mine.filter((c) => c.status === 'redeemed' || c.status === 'expired')
  const newbie = templates.find((t) => t.id === 'CT01')
  const allianceTemplates = templates.filter((t) => t.id !== 'CT01' && t.status === '进行中')

  const tplOf = (id: string) => templates.find((t) => t.id === id)

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="我的券包"
        desc="新客体验券每人限领 1 张，联盟权益券由球馆与万达商户共同发行。每张券拥有唯一券码，可追踪来源与核销记录。"
        rules={['FR-07 券码唯一可追踪', '每人限领1张体验券', 'FR-08 余额不可跨商户支付']}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {newbie && (
            <Card className="overflow-hidden border-gold/40 bg-gold/[0.08]">
              <CardHeader className="gap-1">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Ticket className="size-4 text-gold-foreground" />
                  {newbie.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{newbie.note}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <span className="flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold text-gold-foreground">
                      {yuan(newbie.faceValue)}
                    </span>
                    <span className="text-xs text-muted-foreground">体验价</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {newbie.benefit} · 有效期 {newbie.validFrom} 至 {newbie.validTo}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    已发行 {codes.filter((c) => c.templateId === 'CT01').length}/{newbie.issuedCount} 张
                  </span>
                </div>
                <Button
                  onClick={() => {
                    const res = claimNewbie(me.id)
                    if (res.ok) toast.success(res.message)
                    else toast.error(res.message)
                  }}
                >
                  {mine.some((c) => c.templateId === 'CT01') ? '已领取（重复领取会被拦截）' : '立即领取'}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">联盟权益券</CardTitle>
              <p className="text-xs text-muted-foreground">
                万达广场异业联盟商户提供的权益，核销在商户侧完成，球馆余额不参与支付。
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {allianceTemplates.map((t) => {
                const claimed = mine.some((c) => c.templateId === t.id && c.status !== 'expired')
                const merchant = merchants.find((m) => m.id === t.merchantId)
                return (
                  <div
                    key={t.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold">{t.name}</span>
                        <span className="text-[11px] text-muted-foreground">{merchant?.name}</span>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {merchant?.category}
                      </Badge>
                    </div>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">{t.benefit}</span>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t.validFrom.slice(5)} ~ {t.validTo.slice(5)}
                      </span>
                      <Button
                        size="sm"
                        variant={claimed ? 'secondary' : 'outline'}
                        onClick={() => {
                          const res = claimFromTemplate(t.id, me.id)
                          if (res.ok) toast.success(res.message)
                          else toast.error(res.message)
                        }}
                      >
                        {claimed ? '已领取' : '领取'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">券码明细</CardTitle>
              <p className="text-xs text-muted-foreground">{me.name} 名下的全部券码与状态流转。</p>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="available">
                <TabsList>
                  <TabsTrigger value="available">可用 {available.length}</TabsTrigger>
                  <TabsTrigger value="used">已用 / 过期 {used.length}</TabsTrigger>
                </TabsList>
                <TabsContent value="available" className="flex flex-col gap-2 pt-3">
                  {available.length === 0 && <EmptyHint text="暂无可用券，去上方领取" />}
                  {available.map((c) => {
                    const t = tplOf(c.templateId)
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3',
                          c.templateId === 'CT01' ? 'border-gold/40 bg-gold/[0.06]' : 'border-border bg-card',
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold">{t?.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{c.code}</span>
                          <span className="text-[10px] text-muted-foreground">
                            领取于 {c.claimedAt} · {t?.merchantName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={c.status} />
                          <span className="font-mono text-sm font-semibold">{yuan(t?.faceValue ?? 0)}</span>
                        </div>
                      </div>
                    )
                  })}
                </TabsContent>
                <TabsContent value="used" className="flex flex-col gap-2 pt-3">
                  {used.length === 0 && <EmptyHint text="还没有已核销或过期的券" />}
                  {used.map((c) => {
                    const t = tplOf(c.templateId)
                    return (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold">{t?.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{c.code}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {c.redeemedAt ? `核销于 ${c.redeemedAt} · ${c.redeemedBy}` : '已过期'}
                          </span>
                        </div>
                        <StatusBadge status={c.status} />
                      </div>
                    )
                  })}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <FlowProgress flow={flowByKey('flow1')} />
          <FlowProgress flow={flowByKey('flow4')} />
          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm">下一步</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col">
                <FieldRow label="可用券" value={`${available.length} 张`} mono />
                <FieldRow label="体验券状态" value={mine.some((c) => c.templateId === 'CT01') ? '已领取' : '未领取'} />
              </div>
              <LinkButton href="/member/booking" size="sm" className="w-full">
                用体验券去订场 →
              </LinkButton>
              <LinkButton href="/merchant/redeem" size="sm" variant="outline" className="w-full">
                前往商户端核销 →
              </LinkButton>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
