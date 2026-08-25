'use client'

import { create } from 'zustand'

export type DemoStatus = '正常' | '待处理' | '已完成' | '预警'
export interface InventoryItem { id: string; name: string; sku: string; category: string; stock: number; safeStock: number; price: number; supplier: string; mode: '采购' | '代销' }
export interface HostApplication { id: string; name: string; phone: string; level: string; games: number; revenue: number; status: '待审核' | '已通过' | '已驳回'; risk?: string }
export interface AcademicItem { id: string; student: string; course: string; date: string; coach: string; status: '待上课' | '请假待审' | '待补课' | '已完成'; feedback?: string; contract: string }
export interface Approval { id: string; type: string; applicant: string; amount: number; reason: string; status: '待审批' | '已通过' | '已驳回'; createdAt: string }
export interface ExportRecord { id: string; scope: string; format: string; operator: string; createdAt: string; status: '生成中' | '可下载' }

export const inventorySeed: InventoryItem[] = [
  { id: 'sku-01', name: '比赛级羽毛球', sku: 'YY-Q7-12', category: '用球', stock: 18, safeStock: 24, price: 118, supplier: '北京双羽体育', mode: '采购' },
  { id: 'sku-02', name: '专业手胶三条装', sku: 'GRIP-3-W', category: '配件', stock: 67, safeStock: 20, price: 29.9, supplier: '胜动体育', mode: '代销' },
  { id: 'sku-03', name: '青少年训练服', sku: 'JRS-160-G', category: '服装', stock: 8, safeStock: 10, price: 159, supplier: '山岳运动', mode: '代销' },
  { id: 'sku-04', name: '训练用羽毛球', sku: 'TR-A3-12', category: '培训耗材', stock: 42, safeStock: 30, price: 76, supplier: '北京双羽体育', mode: '采购' },
  { id: 'sku-05', name: '场馆纪念水杯', sku: 'CUP-YQ-01', category: '文创', stock: 35, safeStock: 12, price: 39, supplier: '延庆文创', mode: '代销' },
]

export const hostSeed: HostApplication[] = [
  { id: 'host-01', name: '陈浩', phone: '138****2041', level: '银牌主理人', games: 18, revenue: 12680, status: '已通过' },
  { id: 'host-02', name: '林悦', phone: '136****7812', level: '申请铜牌', games: 6, revenue: 3280, status: '待审核' },
  { id: 'host-03', name: '周博', phone: '189****5630', level: '铜牌主理人', games: 11, revenue: 7360, status: '已通过', risk: '同设备短时重复报名 3 次' },
]

export const academicSeed: AcademicItem[] = [
  { id: 'ac-01', student: '刘一诺', course: '青少年进阶班', date: '08月26日 18:30', coach: '李教练', status: '待上课', contract: 'HT-2026-0815-021' },
  { id: 'ac-02', student: '赵梓涵', course: '青少年启蒙班', date: '08月27日 17:00', coach: '王教练', status: '请假待审', contract: 'HT-2026-0816-008' },
  { id: 'ac-03', student: '孙嘉禾', course: '青少年进阶班', date: '08月29日 18:30', coach: '李教练', status: '待补课', contract: 'HT-2026-0728-013' },
  { id: 'ac-04', student: '马思远', course: '成人提升班', date: '08月24日 20:00', coach: '张教练', status: '已完成', feedback: '后场步法进步明显，继续加强反手过渡。', contract: 'HT-2026-0802-006' },
]

export const approvalSeed: Approval[] = [
  { id: 'RF-260825-03', type: '培训退费', applicant: '赵梓涵监护人', amount: 2160, reason: '转学离京，剩余 12 课时', status: '待审批', createdAt: '08-25 10:42' },
  { id: 'RF-260824-11', type: '订场退款', applicant: '王泽', amount: 80, reason: '临时闭馆', status: '已通过', createdAt: '08-24 16:20' },
]

interface ExtendedState {
  inventory: InventoryItem[]
  hosts: HostApplication[]
  academics: AcademicItem[]
  approvals: Approval[]
  exports: ExportRecord[]
  permissions: Record<string, boolean>
  adjustStock: (id: string, delta: number) => void
  reviewHost: (id: string, status: '已通过' | '已驳回') => void
  updateAcademic: (id: string, status: AcademicItem['status']) => void
  reviewApproval: (id: string, status: '已通过' | '已驳回') => void
  createExport: (scope: string) => void
  togglePermission: (key: string) => void
}

export const useExtendedDemo = create<ExtendedState>((set) => ({
  inventory: inventorySeed,
  hosts: hostSeed,
  academics: academicSeed,
  approvals: approvalSeed,
  exports: [{ id: 'EXP-260825-01', scope: '全量订单流水', format: 'Excel', operator: '老板-演示', createdAt: '08-25 09:10', status: '可下载' }],
  permissions: { 'staff.refund': false, 'staff.adjust': false, 'coach.feedback': true, 'merchant.export': true, 'admin.unmask': true },
  adjustStock: (id, delta) => set((s) => ({ inventory: s.inventory.map((i) => i.id === id ? { ...i, stock: Math.max(0, i.stock + delta) } : i) })),
  reviewHost: (id, status) => set((s) => ({ hosts: s.hosts.map((h) => h.id === id ? { ...h, status } : h) })),
  updateAcademic: (id, status) => set((s) => ({ academics: s.academics.map((a) => a.id === id ? { ...a, status } : a) })),
  reviewApproval: (id, status) => set((s) => ({ approvals: s.approvals.map((a) => a.id === id ? { ...a, status } : a) })),
  createExport: (scope) => set((s) => ({ exports: [{ id: `EXP-${Date.now()}`, scope, format: 'Excel', operator: '老板-演示', createdAt: '刚刚', status: '可下载' }, ...s.exports] })),
  togglePermission: (key) => set((s) => ({ permissions: { ...s.permissions, [key]: !s.permissions[key] } })),
}))

export const eventEnhancements = {
  threshold: 24,
  signed: 22,
  waiting: ['方骏 / 叶可', '贺扬 / 宋雨'],
  rules: ['男双 vs 女双：女双每局 +5 分', '混双 vs 女双：女双每局 +2 分', '20 平后不再执行让分'],
  prizes: ['冠军：YONEX 球拍 2 支', '亚军：比赛球 4 筒', '幸运奖：联盟商户券 10 份'],
  sponsor: '延庆山水体育发展有限公司',
}
