'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ScanLine, ShieldAlert } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, FieldRow, FlowProgress, EmptyHint, RuleNote } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { LinkButton } from '@/components/link-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { yuan } from '@/lib/finance'

const OPERATOR = '店员-王琳'

export default function MerchantRedeemPage() {
  const merchants = useDemoStore((s) => s.merchants)
  const templates = useDemoStore((s) => s.couponTemplates)
  const codes = useDemoStore((s) => s.couponCodes)
  const currentMerchantId = useDemoStore((s) => s.currentMerchantId)
  const redeemCouponCode = useDemoStore((s) => s.redeemCouponCode)

  const merchant = merchants.find((m) => m.id === currentMerchantId) ?? merchants[0]
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState('128')

  const myTemplateIds = useMemo(
    () => templates.filter((t) => t.merchantId === merchant.id).map((t) => t.id),
    [templates, merchant.id],
  )
  const myCodes = useMemo(
    () => codes.filter((c) => myTemplateIds.includes(c.templateId)),
    [codes, myTemplateIds],
  )
  const claimed = myCodes.filter((c) => c.status === 'claimed')
  const redeemed = myCodes.filter((c) => c.status === 'redeemed')

  const handleRedeem = (raw?: string) => {
    const value = (raw ?? code).trim()
    if (!value) {
      toast.error('请输入会员出示的券码')
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('请输入有效的本次消费金额，用于归因成交统计')
      return
    }
    const res = redeemCouponCode(value, merchant.id, OPERATOR, amt)
    if (res.ok) {
      toast.success(res.message)
      setCode('')
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title={`券码核销台 · ${merchant.name}`}
        desc="会员在商户门店出示联盟权益券短码，店员核销后记录本次消费金额作为归因成交，进入球馆与商户的对账口径。"
        rules={['一码一次', '重复核销拦截', '跨商户拦截', '核销即归因']}
      />

      <FlowProgress flow={FLOWS[3]} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label="待核销券码" value={claimed.length} unit="张" tone="gold" />
        <StatCard label="已核销" value={redeemed.length} unit="张" tone="brand" />
        <StatCard
          label="累计归因成交"
          value={yuan(redeemed.reduce((s, c) => s + (c.attributedAmount ?? 0), 0))}
          tone="primary"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <SectionCard title="核销券码" description="输入短码并填写本次消费金额，系统校验券码归属与状态。">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">券码</Label>
              <Input
                id="code"
                value={code}
                placeholder="如 YQ-WD-3301"
                className="font-mono uppercase"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleRedeem()
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amt">本次消费金额（归因）</Label>
              <Input
                id="amt"
                value={amount}
                inputMode="decimal"
                className="font-mono"
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <Button onClick={() => handleRedeem()}>
              <ScanLine className="size-4" />
              确认核销
            </Button>
            <LinkButton href="/admin/alliance" size="sm" variant="outline">
              前往后台联盟对账 →
            </LinkButton>
          </div>
        </SectionCard>

        <SectionCard title="待核销券码列表" description="会员已领取但尚未使用的券码，可直接点击核销进行演示。">
          {claimed.length === 0 ? (
            <EmptyHint text="暂无待核销券码，可在会员端券包领取后再来核销" />
          ) : (
            <ul className="flex flex-col gap-2">
              {claimed.map((c) => {
                const t = templates.find((x) => x.id === c.templateId)
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{t?.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {c.code} · {c.memberName} · 面值 {yuan(t?.faceValue ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        已领取
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => handleRedeem(c.code)}>
                        核销
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <RuleNote title="核销防重复口径">
        每个券码<strong>全局唯一且仅可核销一次</strong>。重复核销、跨商户核销、过期券核销都会被拦截并提示具体原因；
        核销成功后记录核销门店、操作人、核销时间与归因金额。
      </RuleNote>

      <SectionCard title="已核销记录" description="核销明细直接构成商户结算依据。">
        {redeemed.length === 0 ? (
          <EmptyHint text="暂无核销记录" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>券码</TableHead>
                  <TableHead>会员</TableHead>
                  <TableHead>券名称</TableHead>
                  <TableHead className="text-right">归因金额</TableHead>
                  <TableHead>核销时间</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {redeemed.map((c) => {
                  const t = templates.find((x) => x.id === c.templateId)
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{c.code}</TableCell>
                      <TableCell className="text-sm">{c.memberName ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t?.name}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {yuan(c.attributedAmount ?? 0)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {c.redeemedAt ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.redeemedBy ?? '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <ShieldAlert className="mt-0.5 size-4 text-destructive" aria-hidden />
        <p className="text-xs leading-relaxed text-foreground/80">
          测试提示：对同一张券码连续点击两次核销，第二次会被系统拦截并提示「该券码已于 … 核销」，
          用于验证防重复核销与对账一致性。
        </p>
      </div>
    </div>
  )
}
