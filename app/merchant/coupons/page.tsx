'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useDemoStore } from '@/lib/store'
import { PageIntro, SectionCard, StatCard, EmptyHint, RuleNote } from '@/components/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { yuan } from '@/lib/finance'
import { DEMO_TODAY } from '@/lib/seed'

export default function MerchantCouponsPage() {
  const merchants = useDemoStore((s) => s.merchants)
  const templates = useDemoStore((s) => s.couponTemplates)
  const codes = useDemoStore((s) => s.couponCodes)
  const currentMerchantId = useDemoStore((s) => s.currentMerchantId)
  const createCouponTemplate = useDemoStore((s) => s.createCouponTemplate)

  const merchant = merchants.find((m) => m.id === currentMerchantId) ?? merchants[0]
  const [form, setForm] = useState({
    name: '',
    activity: '万达异业联盟',
    benefit: '',
    faceValue: '50',
    validFrom: DEMO_TODAY,
    validTo: '2026-09-30',
    issuedCount: '200',
    note: '',
  })

  const myTemplates = useMemo(
    () => templates.filter((t) => t.merchantId === merchant.id),
    [templates, merchant.id],
  )

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleCreate = () => {
    if (!form.name.trim() || !form.benefit.trim()) {
      toast.error('请填写券名称与权益说明')
      return
    }
    const face = Number(form.faceValue)
    const issued = Number(form.issuedCount)
    if (!Number.isFinite(face) || face <= 0) {
      toast.error('面值必须为正数')
      return
    }
    if (!Number.isInteger(issued) || issued <= 0) {
      toast.error('发行量必须为正整数')
      return
    }
    if (form.validTo < form.validFrom) {
      toast.error('有效期结束日期不能早于开始日期')
      return
    }
    const res = createCouponTemplate({
      name: form.name.trim(),
      merchantId: merchant.id,
      activity: form.activity,
      benefit: form.benefit.trim(),
      faceValue: face,
      validFrom: form.validFrom,
      validTo: form.validTo,
      issuedCount: issued,
      note: form.note.trim(),
    })
    if (res.ok) {
      toast.success(res.message)
      setForm((f) => ({ ...f, name: '', benefit: '', note: '' }))
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title={`权益券管理 · ${merchant.name}`}
        desc="创建券模板并设定面值、有效期与发行量；会员在小程序券包领取后生成唯一短码，核销时按券码追溯到人到店。"
        rules={['模板发行量受控', '券码全局唯一', '过期自动失效']}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="券模板数" value={myTemplates.length} unit="个" />
        <StatCard label="计划发行量" value={myTemplates.reduce((s, t) => s + t.issuedCount, 0)} unit="张" tone="primary" />
        <StatCard
          label="已生成券码"
          value={codes.filter((c) => myTemplates.some((t) => t.id === c.templateId)).length}
          unit="张"
          tone="brand"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard title="新建券模板" description="模板创建后即可在会员端券包中被领取。">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cname">券名称</Label>
              <Input
                id="cname"
                value={form.name}
                placeholder="如 运动餐8折券"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="benefit">权益说明</Label>
              <Input
                id="benefit"
                value={form.benefit}
                placeholder="如 到店消费满100元享8折"
                onChange={(e) => set('benefit', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="face">面值（元）</Label>
                <Input
                  id="face"
                  value={form.faceValue}
                  inputMode="decimal"
                  className="font-mono"
                  onChange={(e) => set('faceValue', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="issued">发行量（张）</Label>
                <Input
                  id="issued"
                  value={form.issuedCount}
                  inputMode="numeric"
                  className="font-mono"
                  onChange={(e) => set('issuedCount', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from">生效日期</Label>
                <Input id="from" type="date" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to">失效日期</Label>
                <Input id="to" type="date" value={form.validTo} onChange={(e) => set('validTo', e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">备注（选填）</Label>
              <Textarea id="note" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
            </div>
            <Button onClick={handleCreate}>
              <Plus className="size-4" />
              创建券模板
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="我的券模板" description="按模板查看领取与核销进度，核销率是联盟效果的核心指标。">
          {myTemplates.length === 0 ? (
            <EmptyHint text="暂无券模板" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>券名称</TableHead>
                    <TableHead className="text-right">面值</TableHead>
                    <TableHead className="text-right">发行/领取/核销</TableHead>
                    <TableHead>有效期</TableHead>
                    <TableHead>活动</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myTemplates.map((t) => {
                    const tc = codes.filter((c) => c.templateId === t.id)
                    const rd = tc.filter((c) => c.status === 'redeemed').length
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium">{t.name}</span>
                            <span className="text-[11px] text-muted-foreground">{t.benefit}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{yuan(t.faceValue)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {t.issuedCount} / {tc.length} / {rd}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                          {t.validFrom} ~ {t.validTo}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {t.activity}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>

      <RuleNote title="联盟券对账口径">
        券模板的发行量为<strong>上限控制</strong>，领取数不可超过发行量；每张券码绑定唯一会员与唯一核销记录，
        对账时以「核销数 × 归因金额」为结算依据，避免商户与球馆口径不一致。
      </RuleNote>
    </div>
  )
}
