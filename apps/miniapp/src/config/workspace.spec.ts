import { describe, expect, it } from 'vitest'
import { managementKeys, visibleWorkspaceTabs, workspaceGroups, workspaceMenu } from './workspace'
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

it('separates daily operations from configuration without duplicated entry placement', () => {
  const businessKeys = workspaceGroups.flatMap(group => group.keys)
  for (const key of ['training-products','coupon-campaigns']) {
    expect(managementKeys).toContain(key)
    expect(businessKeys).not.toContain(key)
    expect(workspaceMenu(['SUPER_ADMIN']).some(item => item.key === key)).toBe(true)
  }
  expect(workspaceMenu(['FRONT_DESK']).some(item => ['training-products','coupon-campaigns'].includes(item.key))).toBe(false)
})
