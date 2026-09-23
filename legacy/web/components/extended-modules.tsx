'use client'

import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Download, FileText, PackageCheck, Plus, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { PageIntro, SectionCard, StatCard } from '@/components/blocks'
import { useExtendedDemo, eventEnhancements } from '@/lib/extended-demo'
import { cn } from '@/lib/utils'

export function InventoryModule({ mode = 'admin' }: { mode?: 'admin' | 'staff' | 'member' }) {
  const items = useExtendedDemo((s) => s.inventory)
  const adjust = useExtendedDemo((s) => s.adjustStock)
  const low = items.filter((i) => i.stock <= i.safeStock).length
  if (mode === 'member') return <ShopModule />
  return <div className="flex flex-col gap-3" data-guide="inventory-list">
    <PageIntro title="商品与库存" desc="商品、供应商、采购、代销、领用和盘点统一管理。" rules={['库存不足禁止出库', '采购与代销分开结算']} />
    <div className="grid grid-cols-2 gap-2"><StatCard label="在售 SKU" value={items.length} unit="个"/><StatCard label="低库存预警" value={low} unit="项" tone="gold"/></div>
    <SectionCard title={mode === 'staff' ? '销售与领用' : '实时库存'} description="低于安全库存的商品自动预警">
      <div className="flex flex-col divide-y divide-border">
        {items.map((i) => <div key={i.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', i.stock <= i.safeStock ? 'bg-gold/15 text-gold-foreground' : 'bg-secondary text-primary')}><PackageCheck className="size-4"/></div>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-medium">{i.name}</p>{i.stock <= i.safeStock && <Badge variant="outline" className="text-[10px]">预警</Badge>}</div><p className="font-mono text-[10px] text-muted-foreground">{i.sku} · {i.mode} · {i.supplier}</p></div>
          <div className="text-right"><p className="font-mono text-sm font-semibold">{i.stock}</p><p className="text-[10px] text-muted-foreground">安全 {i.safeStock}</p></div>
          <Button size="sm" variant="outline" onClick={() => { if(i.stock <= 0) return toast.error('库存不足，禁止出库'); adjust(i.id, mode === 'staff' ? -1 : 12); toast.success(mode === 'staff' ? '已出库 1 件' : '采购入库 12 件') }}>{mode === 'staff' ? '出库' : '入库'}</Button>
        </div>)}
      </div>
    </SectionCard>
    {mode === 'admin' && <div className="grid grid-cols-3 gap-2">{['采购入库','培训领用','盘点调整'].map((x)=><Button key={x} variant="secondary" className="text-xs" onClick={()=>toast.success(`${x}单已生成并记入审计`)}>{x}</Button>)}</div>}
  </div>
}

export function ShopModule() {
  const items = useExtendedDemo((s) => s.inventory)
  const adjust = useExtendedDemo((s) => s.adjustStock)
  return <div className="flex flex-col gap-3" data-guide="shop-list">
    <PageIntro title="场馆商城" desc="商品库存与线下销售同步，售罄商品不可购买。" rules={['实时库存', '订单四要素留痕']} />
    <div className="flex gap-2 overflow-x-auto pb-1">{['全部','用球','配件','服装','文创'].map((x,i)=><button key={x} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs',i===0?'bg-primary text-primary-foreground':'bg-card')}>{x}</button>)}</div>
    <div className="grid grid-cols-2 gap-2">{items.filter(i=>i.category!=='培训耗材').map(i=><article key={i.id} className="flex flex-col gap-2 rounded-xl bg-card p-3"><div className="flex h-20 items-center justify-center rounded-lg bg-secondary"><PackageCheck className="size-7 text-primary/60"/></div><div><p className="line-clamp-1 text-sm font-medium">{i.name}</p><p className="text-[10px] text-muted-foreground">库存 {i.stock}</p></div><div className="flex items-center justify-between"><span className="font-mono text-sm font-bold text-primary">¥{i.price}</span><Button size="icon-sm" disabled={i.stock<=0} onClick={()=>{adjust(i.id,-1);toast.success('购买成功，订单已生成')}} aria-label={`购买${i.name}`}><Plus className="size-4"/></Button></div></article>)}</div>
  </div>
}

export function HostsModule({ admin = false }: { admin?: boolean }) {
  const hosts = useExtendedDemo((s)=>s.hosts); const review=useExtendedDemo((s)=>s.reviewHost)
  return <div className="flex flex-col gap-3" data-guide="host-review"><PageIntro title="主理人中心" desc="申请、等级、球局收益和异常报名统一处理。" rules={['实名申请', '异常报名可冻结奖励']}/>
    <div className="grid grid-cols-2 gap-2"><StatCard label="活跃主理人" value={hosts.filter(h=>h.status==='已通过').length} unit="人"/><StatCard label="待审核" value={hosts.filter(h=>h.status==='待审核').length} unit="人" tone="gold"/></div>
    <SectionCard title={admin?'申请与经营':'我的主理人经营'}>{hosts.map(h=><div key={h.id} className="flex flex-col gap-2 border-b border-border py-3 first:pt-0 last:border-0 last:pb-0"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{h.name} <span className="text-xs font-normal text-muted-foreground">{h.phone}</span></p><p className="text-xs text-muted-foreground">{h.level} · {h.games} 场 · 收益 ¥{h.revenue.toLocaleString()}</p></div><Badge variant={h.status==='待审核'?'outline':'secondary'}>{h.status}</Badge></div>{h.risk&&<p className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3"/>{h.risk}</p>}{admin&&h.status==='待审核'&&<div className="flex gap-2"><Button size="sm" className="flex-1" onClick={()=>{review(h.id,'已通过');toast.success('已通过申请并配置铜牌权限')}}>通过</Button><Button size="sm" variant="outline" className="flex-1" onClick={()=>review(h.id,'已驳回')}>驳回</Button></div>}</div>)}</SectionCard>
    {!admin&&<Button onClick={()=>toast.success('主理人申请已提交，预计 1 个工作日审核')}>申请成为主理人</Button>}
  </div>
}

export function AcademicsModule({ staff=false }: { staff?: boolean }) {
 const list=useExtendedDemo(s=>s.academics); const update=useExtendedDemo(s=>s.updateAcademic)
 return <div className="flex flex-col gap-3" data-guide="academic-list"><PageIntro title="培训教务" desc="课表、签到、请假、补课、反馈和合同形成完整教务链。" rules={['请假需审核', '补课不重复确认收入']}/>
 <div className="flex gap-2 overflow-x-auto">{['全部课表','请假','补课','合同'].map((x,i)=><button key={x} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs',i===0?'bg-primary text-primary-foreground':'bg-card')}>{x}</button>)}</div>
 <SectionCard title="本周课表">{list.map(a=><div key={a.id} className="flex gap-3 border-b border-border py-3 first:pt-0 last:border-0 last:pb-0"><div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-secondary text-[10px]"><span>{a.date.slice(0,5)}</span><strong>{a.date.slice(6)}</strong></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{a.student} · {a.course}</p><p className="text-xs text-muted-foreground">{a.coach} · 合同 {a.contract}</p>{a.feedback&&<p className="mt-1 text-xs text-primary">反馈：{a.feedback}</p>}</div><div className="flex flex-col items-end gap-1"><Badge variant="outline">{a.status}</Badge>{staff&&a.status!=='已完成'&&<Button size="xs" variant="ghost" onClick={()=>{update(a.id,a.status==='请假待审'?'待补课':'已完成');toast.success(a.status==='请假待审'?'请假已通过，进入补课池':'已签到并记录课后反馈')}}>{a.status==='请假待审'?'审核':'签到'}</Button>}</div></div>)}</SectionCard>
 <Button variant="outline" onClick={()=>toast.success('电子合同预览已生成')}><FileText className="size-4"/>查看电子合同</Button></div>
}

export function EventRulesModule() { return <div className="flex flex-col gap-3" data-guide="event-rules"><PageIntro title="赛事规则与保障" desc="成赛、候补、让分、奖品与有奖销售记录。" rules={['24人成赛', '20平后不让分']}/><div className="grid grid-cols-2 gap-2"><StatCard label="已签到组合" value={eventEnhancements.signed} unit={`/ ${eventEnhancements.threshold}`}/><StatCard label="候补组合" value={eventEnhancements.waiting.length} unit="组" tone="gold"/></div><SectionCard title="让分规则">{eventEnhancements.rules.map(x=><div key={x} className="flex items-center gap-2 py-2 text-sm"><Check className="size-4 text-brand"/><span>{x}</span></div>)}</SectionCard><SectionCard title="赞助与奖品池" description={`赞助方：${eventEnhancements.sponsor}`}>{eventEnhancements.prizes.map((x,i)=><div key={x} className="flex items-center justify-between py-2 text-sm"><span>{x}</span><Badge variant="secondary">{i===2?'抽奖留痕':'名次奖'}</Badge></div>)}<Button className="mt-2 w-full" onClick={()=>toast.success('幸运奖已抽取：组合 08，全程已留痕')}>执行公开抽奖</Button></SectionCard><Button variant="outline" onClick={()=>toast.success('战绩海报与分享二维码已生成')}>生成赛事战绩海报</Button></div> }

export function ApprovalsModule() { const list=useExtendedDemo(s=>s.approvals);const review=useExtendedDemo(s=>s.reviewApproval);return <div className="flex flex-col gap-3" data-guide="approval-list"><PageIntro title="审批中心" desc="退款和敏感操作需要有权限角色二次确认。" rules={['审批与执行分离','全程审计']}/><SectionCard title="待办审批">{list.map(a=><div key={a.id} className="flex flex-col gap-2 border-b border-border py-3 first:pt-0 last:border-0 last:pb-0"><div className="flex justify-between"><div><p className="text-sm font-medium">{a.type} · {a.applicant}</p><p className="text-xs text-muted-foreground">{a.id} · {a.createdAt}</p></div><span className="font-mono font-semibold">¥{a.amount}</span></div><p className="text-xs text-muted-foreground">{a.reason}</p>{a.status==='待审批'?<div className="flex gap-2"><Button size="sm" className="flex-1" onClick={()=>{review(a.id,'已通过');toast.success('审批通过，退款进入原路退回队列')}}>批准</Button><Button size="sm" variant="outline" className="flex-1" onClick={()=>review(a.id,'已驳回')}>驳回</Button></div>:<Badge className="self-start" variant="secondary">{a.status}</Badge>}</div>)}</SectionCard></div> }

export function PermissionsModule() { const p=useExtendedDemo(s=>s.permissions);const toggle=useExtendedDemo(s=>s.togglePermission);const labels:Record<string,string>={'staff.refund':'员工发起退款','staff.adjust':'员工人工调账','coach.feedback':'教练填写反馈','merchant.export':'商户导出对账','admin.unmask':'老板查看完整手机号'};return <div className="flex flex-col gap-3" data-guide="permission-matrix"><PageIntro title="权限与脱敏" desc="角色到操作级权限，敏感数据按职责最小化展示。" rules={['最小权限','敏感操作二次确认']}/><SectionCard title="操作权限矩阵">{Object.entries(p).map(([k,v])=><div key={k} className="flex items-center justify-between border-b border-border py-3 first:pt-0 last:border-0 last:pb-0"><div><p className="text-sm font-medium">{labels[k]}</p><p className="text-xs text-muted-foreground">{k.split('.')[0]} · {v?'已授权':'未授权'}</p></div><Switch checked={v} onCheckedChange={()=>{toggle(k);toast.success('权限已更新并写入审计')}}/></div>)}</SectionCard><SectionCard title="脱敏预览"><div className="flex items-center justify-between py-2 text-sm"><span>普通员工看到</span><span className="font-mono">138****2041</span></div><div className="flex items-center justify-between py-2 text-sm"><span>老板授权查看</span><span className="font-mono">138 0011 2041</span></div></SectionCard></div> }

export function DataGovernanceModule() { const ex=useExtendedDemo(s=>s.exports);const create=useExtendedDemo(s=>s.createExport);const [account,setAccount]=useState('13800112041');return <div className="flex flex-col gap-3" data-guide="data-export"><PageIntro title="数据与治理" desc="覆盖 Excel 导出、备份、迁出、注销与匿名化演示。" rules={['导出留痕','注销后业务单据保留匿名引用']}/><div className="grid grid-cols-2 gap-2">{['订单流水','培训核算','联盟对账','库存台账'].map(x=><Button key={x} variant="secondary" className="justify-between" onClick={()=>{create(x);toast.success(`${x} Excel 已生成`)}}>{x}<Download className="size-4"/></Button>)}</div><SectionCard title="最近导出">{ex.map(x=><div key={x.id} className="flex items-center justify-between py-2"><div><p className="text-sm font-medium">{x.scope}</p><p className="text-[10px] text-muted-foreground">{x.createdAt} · {x.operator}</p></div><Badge variant="secondary">{x.status}</Badge></div>)}</SectionCard><SectionCard title="备份与迁出"><div className="flex items-center justify-between py-2 text-sm"><span>每日自动备份</span><span className="text-brand">今日 03:00 成功</span></div><Button variant="outline" className="mt-2 w-full" onClick={()=>toast.success('全量迁出包正在生成')}>生成全量数据迁出包</Button></SectionCard><SectionCard title="账号注销与匿名化"><div className="flex gap-2"><Input value={account} onChange={e=>setAccount(e.target.value)} aria-label="待注销手机号"/><Button variant="destructive" onClick={()=>toast.success('账号已注销，历史单据已匿名化')}>注销</Button></div></SectionCard></div> }
