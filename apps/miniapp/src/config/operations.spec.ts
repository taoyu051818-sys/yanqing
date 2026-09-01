import { describe, expect, it } from 'vitest'
import {
  hasOperationsAccess,
  operationsAccessRoles,
  operationsCenters,
  preferredOperationsCenter,
  visibleOperationsCenters,
} from './operations'

describe('operations navigation', () => {
  it('keeps center names unique and routes stable', () => {
    expect(new Set(operationsCenters.map((center) => center.title)).size).toBe(operationsCenters.length)
    expect(new Set(operationsCenters.map((center) => center.route)).size).toBe(operationsCenters.length)
  })

  it('shows an external merchant only its alliance center', () => {
    expect(visibleOperationsCenters(['MERCHANT']).map((center) => center.key)).toEqual(['alliance'])
    expect(preferredOperationsCenter(['MERCHANT'])?.key).toBe('alliance')
  })

  it('chooses the actual role workspace instead of the first shared center', () => {
    expect(preferredOperationsCenter(['COACH'])?.key).toBe('training')
    expect(preferredOperationsCenter(['FINANCE'])?.key).toBe('finance')
  })

  it('keeps administrators on the unified work queue instead of choosing a role center', () => {
    expect(visibleOperationsCenters(['ADMIN']).length).toBe(operationsCenters.length)
    expect(preferredOperationsCenter(['ADMIN'])).toBeNull()
  })

  it('does not expose employee centers to a member', () => {
    expect(visibleOperationsCenters(['MEMBER'])).toEqual([])
  })

  it('rejects members from every operations deep link scope', () => {
    for (const scope of Object.keys(operationsAccessRoles) as Array<keyof typeof operationsAccessRoles>) {
      expect(hasOperationsAccess(['MEMBER'], scope)).toBe(false)
    }
  })

  it('keeps administrators authorized for every operations deep link scope', () => {
    for (const scope of Object.keys(operationsAccessRoles) as Array<keyof typeof operationsAccessRoles>) {
      expect(hasOperationsAccess(['ADMIN'], scope)).toBe(true)
    }
  })

  it('keeps role centers isolated across direct links', () => {
    expect(hasOperationsAccess(['COACH'], 'training')).toBe(true)
    expect(hasOperationsAccess(['COACH'], 'games')).toBe(false)
    expect(hasOperationsAccess(['HOST'], 'games')).toBe(true)
    expect(hasOperationsAccess(['HOST'], 'training')).toBe(false)
    expect(hasOperationsAccess(['FINANCE'], 'finance')).toBe(true)
    expect(hasOperationsAccess(['FINANCE'], 'training')).toBe(false)
    expect(hasOperationsAccess(['FINANCE'], 'inventory')).toBe(false)
    expect(hasOperationsAccess(['COACH'], 'inventory')).toBe(false)
    expect(hasOperationsAccess(['EVENT_MANAGER'], 'inventory')).toBe(false)
    expect(hasOperationsAccess(['FRONT_DESK'], 'inventory')).toBe(true)
    expect(hasOperationsAccess(['MERCHANT'], 'inventory')).toBe(false)
  })
})
