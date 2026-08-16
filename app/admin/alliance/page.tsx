'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'
import { PageIntro, SectionCard, StatCard, RuleNote, EmptyHint, StatusBadge } from '@/components/blocks'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDemoStore } from '@/lib/store'
import { round2 } from '@/lib/finance'

export default function AdminAlliancePage() {
  const merchants = useDemoStore((s) => s.merchants)
  const templates = useDemoStore((s) => s.couponTemplates)
  const codes = useDemoStore((s) => s.couponCodes)
  const settleMerchant = useDemoStore((s) => s.settleMerchant)

  const rows = useMemo(
    () =>
      merchants.map((m) => {
        const tpls = templates.filter((t) => t.merchantId === m.id)
        const tplIds = tpls.map((t) => t.id)
        const mine = codes.filter((c) => tplIds.includes(c.templateId))
        const claimed = mine.filter((c) => c.status === 'claimed' || c.status === 'redeemed').length
        const redeemed = mine.filter((c) => c.status === 'redeemed')
        const gmv = round2(redeemed.reduce((s, c) => s + (c.attributedAmount ?? 0), 0))
        return {
          merchant: m,
          issued: mine.length,
          claimed,
          redeemedCount: redeemed.length,
          gmv,
          claimRate: mine.length === 0 ? 0 : Math.round((claimed / mine.length) * 100),
          redeemRate: claimed === 0 ? 0 : Math.round((redeemed.length / claimed) * 100),
        }
      }),
    [merchants, templates, codes],
  )

  const totalGmv = round2(rows.reduce((s, r) => s + r.gmv, 0))
  const totalRedeemed = rows.reduce((s, r) => s + r.redeemedCount, 0)
  const totalIssued = rows.reduce((s, r) => s + r.issued, 0)

  return (
    <div>
      <PageIntro
        title="联盟对账 · 券码追踪与商户结算"
        desc="每张券码从发行、领取到核销全程可追踪，归因成交额按核销时记录的金额累计。对账完成后方可结算，避免重复核销与虚假归因。"
        rules={['一码一次核销', '归因成交按核销记录', '对账后结算']}
      />

      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="发行券码" value={totalIssued} unit="张" />
          <StatCard label="已核销" value={totalRedeemed} unit="张" tone="brand" />
          <StatCard label="归因成交额" value={totalGmv.toLocaleString('zh-CN')} unit="元" tone="primary" />
          <StatCard
            label="待结算商户"
            value={merchants.filter((m) => m.settlementStatus !== '已结算').length}
            unit="家"
            tone="gold"
          />
        </div>

        <SectionCard
          title="商户对账明细"
          description="逐个商户核对发行量、领取率、核销率与归因成交额，确认无异常后执行结算。"
        >
          {rows.length === 0 ? (
            <EmptyHint text="暂无联盟商户" />
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((r) => (
                <div key={r.merchant.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-foreground">{r.merchant.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.merchant.category} · {r.merchant.contact}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.merchant.settlementStatus} />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={r.merchant.settlementStatus === '已结算'}
                        onClick={() => {
                          const res = settleMerchant(r.merchant.id, '张总（老板）')
                          if (res.ok) toast.success(res.message)
                          else toast.error(res.message)
                        }}
                      >
                        {r.merchant.settlementStatus === '已结算' ? '已结算' : '确认结算'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">发行 / 领取</span>
                      <span className="font-mono text-sm text-foreground">
                        {r.issued} / {r.claimed}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">已核销</span>
                      <span className="font-mono text-sm text-foreground">{r.redeemedCount}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">归因成交额</span>
                      <span className="font-mono text-sm font-semibold text-primary">
                        ¥{r.gmv.toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">有效新客</span>
                      <span className="font-mono text-sm text-foreground">{r.merchant.effectiveNewCustomers}</span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>领取率</span>
                        <span className="font-mono">{r.claimRate}%</span>
                      </div>
                      <Progress value={r.claimRate} className="h-1.5" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>核销率</span>
                        <span className="font-mono">{r.redeemRate}%</span>
                      </div>
                      <Progress value={r.redeemRate} className="h-1.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="券码明细" description="全量券码状态追踪，可定位到具体领取人、核销时间与经办人。">
          {codes.length === 0 ? (
            <EmptyHint text="暂无券码" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">券码</th>
                    <th className="py-2 pr-3 font-medium">模板</th>
                    <th className="py-2 pr-3 font-medium">状态</th>
                    <th className="py-2 pr-3 font-medium">领取人</th>
                    <th className="py-2 pr-3 font-medium">核销时间</th>
                    <th className="py-2 pr-3 font-medium">经办</th>
                    <th className="py-2 pr-3 text-right font-medium">归因金额</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.slice(0, 40).map((c) => (
                    <tr key={c.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 font-mono font-medium text-foreground">{c.code}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {templates.find((t) => t.id === c.templateId)?.name ?? c.templateId}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{c.memberName ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">{c.redeemedAt ?? '—'}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{c.redeemedBy ?? '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono text-foreground">
                        {c.attributedAmount ? `¥${c.attributedAmount.toLocaleString('zh-CN')}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <RuleNote title="归因与结算的防错设计">
          券码状态机为「已发行 → 已领取 → 已核销」单向流转，核销时写入时间、经办人与成交金额，重复提交会被直接拦截。结算只汇总已核销券码的归因金额，未核销的发行量不计入商户业绩，防止刷量。
        </RuleNote>
      </div>
    </div>
  )
}
