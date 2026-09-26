import { describe, expect, it } from 'vitest'
import { managementKeys, visibleWorkspaceTabs, workspaceGroups, workspaceMenu, workspaceShortcuts } from './workspace'
import { operationsAccessRoles, visibleOperationsCenters } from './operations'
import type { AppRole } from '../types/domain'

describe('经营台按岗位提供完整导航', () => {
  it.each(operationsAccessRoles.workQueue)('%s 的已有业务入口没有因重新分组而丢失', role => {
    const roles: AppRole[] = [role]
    const menu = workspaceMenu(roles)
    const renderedKeys = [...managementKeys, ...workspaceGroups.flatMap(group => group.keys)]
    for (const center of visibleOperationsCenters(roles)) {
      expect(menu.some(item => item.key === center.key && item.route === center.route)).toBe(true)
    }
    expect(menu.every(item => renderedKeys.includes(item.key))).toBe(true)
    expect(new Set(menu.map(item => item.key)).size).toBe(menu.length)
  })
  it('会员没有经营入口，教练只有业务和待办，财务不获得场地设置', () => {
    expect(visibleWorkspaceTabs(['MEMBER'])).toEqual([])
    expect(visibleWorkspaceTabs(['COACH']).map(tab => tab.key)).toEqual(['today', 'business'])
    expect(workspaceMenu(['FINANCE']).some(item => ['courts', 'venue-profile', 'booking'].includes(item.key))).toBe(false)
    expect(workspaceMenu(['FINANCE']).find(item => item.key === 'governance')?.title).toBe('风险与审计')
    expect(visibleWorkspaceTabs(['SUPER_ADMIN']).map(tab => tab.key)).toEqual(['today', 'business', 'data', 'manage'])
  })
})

describe('岗位高频任务直达', () => {
  it('前台一步进入代订、订单和预约试听，不受菜单排列影响', () => {
    expect(workspaceShortcuts(['FRONT_DESK']).map(({ key, route }) => ({ key, route }))).toEqual([
      { key:'booking', route:'/pages/booking/index' },
      { key:'transactions', route:'/packages/ops/pages/transactions/index' },
      { key:'trial-create', route:'/packages/ops/pages/coach/index?view=create-trial' },
    ])
  })
  it('教练直达今天课表、试听跟进和档案，不出现配置或财务', () => {
    const tasks = workspaceShortcuts(['COACH'])
    expect(tasks.map(item => item.title)).toEqual(['今日课表', '试听跟进', '学员档案'])
    expect(tasks.map(item => item.route)).toEqual([
      '/packages/ops/pages/coach/index?view=lessons',
      '/packages/ops/pages/coach/index?view=trials',
      '/packages/ops/pages/members/index',
    ])
  })
  it('多岗位排序稳定，管理员优先经营操作，配置仍在管理页', () => {
    expect(workspaceShortcuts(['COACH', 'FRONT_DESK'])).toEqual(workspaceShortcuts(['FRONT_DESK', 'COACH']))
    expect(workspaceShortcuts(['COACH', 'ADMIN']).map(item => item.key)).toEqual(['transactions', 'booking', 'training'])
    expect(workspaceShortcuts(['ADMIN']).some(item => managementKeys.includes(item.key))).toBe(false)
    expect(workspaceShortcuts(['MEMBER'])).toEqual([])
  })
  it.each(operationsAccessRoles.workQueue)('%s 的快捷任务保持已有权限边界', role => {
    const roles: AppRole[] = [role]
    const routes = workspaceMenu(roles).map(item => item.route.split('?')[0])
    for (const task of workspaceShortcuts(roles)) expect(routes).toContain(task.route.split('?')[0])
  })
})

it('separates daily operations from configuration without duplicated entry placement', () => {
  const businessKeys = workspaceGroups.flatMap(group => group.keys)
  for (const key of ['training-products','coupon-campaigns']) {
    expect(managementKeys).toContain(key)
    expect(businessKeys).not.toContain(key)
    expect(workspaceMenu(['SUPER_ADMIN']).some(item => item.key === key)).toBe(true)
  }
  expect(workspaceMenu(['FRONT_DESK']).some(item => ['training-products','coupon-campaigns'].includes(item.key))).toBe(false)
})
