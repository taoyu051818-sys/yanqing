'use client'

import { useMemo } from 'react'
import { ArrowRight, Ticket, ScanLine } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, EmptyHint, FlowProgress } from '@/components/blocks'
import { FLOWS } from '@/lib/flows'
import { LinkButton } from '@/components/link-button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { computeAllianceRows, yuan } from '@/lib/finance'

export default function MerchantHomePage() {
  const merchants = useDemoStore((s) => s.merchants)
  const templates = useDemoStore((s) => s.couponTemplates)
  const codes = useDemoStore((s) => s.couponCodes)
  const currentMerchantId = useDemoStore((s) => s.currentMerchantId)
  const setCurrentMerchant = useDemoStore((s) => s.setCurrentMerchant)

  const rows = useMemo(() => computeAllianceRows(merchants, templates, codes), [merchants, templates, codes])
  const row = rows.find((r) => r.merchant.id === currentMerchantId) ?? rows[0]

  if (!row) return <EmptyHint text="暂无商户" />

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="商户概览"
        desc="异业联盟商户的券发行、领取、核销与归因成交一屏可查；核销后的归因金额进入球馆与商户共同对账口径。"
        rules={['券码唯一', '核销即归因', '对账可追溯']}
      >
        <Select value={row.merchant.id} onValueChange={(v) => v && setCurrentMerchant(v)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {merchants.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageIntro>

      <FlowProgress flow={FLOWS[3]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="发行量" value={row.issued} unit="张" hint={`${row.templates.length} 个券模板`} />
        <StatCard label="已领取" value={row.claimed} unit="张" tone="primary" />
        <StatCard label="已核销" value={row.redeemed} unit="张" hint={`核销率 ${row.redeemRate}%`} tone="brand" />
        <StatCard label="归因成交" value={yuan(row.attributedGmv)} hint={`ROI ${row.roi}`} tone="gold" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard title="权益券管理" description="创建券模板、设定面值有效期与发行量。">
          <div className="flex items-center justify-between gap-2">
            <Ticket className="size-5 text-muted-foreground" aria-hidden />
            <LinkButton href="/merchant/coupons" size="sm" variant="outline">
              管理券模板
              <ArrowRight className="size-3.5" />
            </LinkButton>
          </div>
        </SectionCard>
        <SectionCard title="券码核销" description="输入会员出示的短码完成核销，重复核销将被拦截。">
          <div className="flex items-center justify-between gap-2">
            <ScanLine className="size-5 text-muted-foreground" aria-hidden />
            <LinkButton href="/merchant/redeem" size="sm">
              前往核销
              <ArrowRight className="size-3.5" />
            </LinkButton>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="商户档案"
        description="合作费用与结算状态由球馆后台统一对账，结算金额以实际核销归因为准。"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="商户类型" value={row.merchant.category} />
          <StatCard label="联系人" value={row.merchant.contact} />
          <StatCard label="合作费用" value={yuan(row.cooperationFee)} />
          <StatCard label="有效新客" value={row.effectiveNewCustomers} unit="人" tone="brand" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">结算状态</span>
          <Badge variant="outline">{row.settlementStatus}</Badge>
        </div>
      </SectionCard>

      <SectionCard title="我的券模板" description="按模板查看发行量与核销进度。">
        {row.templates.length === 0 ? (
          <EmptyHint text="暂无券模板，可前往「权益券管理」创建" />
        ) : (
          <ul className="flex flex-col gap-2">
            {row.templates.map((t) => {
              const tCodes = codes.filter((c) => c.templateId === t.id)
              const redeemed = tCodes.filter((c) => c.status === 'redeemed').length
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{t.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {t.id} · 面值 {yuan(t.faceValue)} · 有效期 {t.validFrom} ~ {t.validTo}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      发行 {t.issuedCount} · 领取 {tCodes.length} · 核销 {redeemed}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {t.activity}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
