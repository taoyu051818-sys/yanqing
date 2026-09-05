import { describe, expect, it, vi } from 'vitest'
import { AppRole } from '../generated/prisma/enums.js'
import { MembersService } from './members.service.js'
import { LeadOwnerQueryDto } from './members.dto.js'
describe('authorized lead owner directory', () => {
  it('returns only names and assignable roles with server-side search/pagination', async () => {
    const user = { id: 'coach-1', displayName: '王教练', phone: 'private-phone', openId: 'secret', primaryRole: AppRole.MEMBER, roles: [{ role: AppRole.COACH }, { role: AppRole.MEMBER }] }
    const prisma: any = { user: { findMany: vi.fn().mockResolvedValue([user]), count: vi.fn().mockResolvedValue(21) },
      $transaction: vi.fn(work => Promise.all(work)) }
    const query = { ...new LeadOwnerQueryDto(), keyword: '王', page: 2 }
    const result = await new MembersService(prisma).leadOwners(query, { sub: 'fd', displayName: '前台', roles: [AppRole.FRONT_DESK] })
    expect(result.items).toEqual([{ id: 'coach-1', displayName: '王教练', roles: ['COACH'] }])
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20,
      where: expect.objectContaining({ status: 'ACTIVE', deletedAt: null, displayName: { contains: '王', mode: 'insensitive' } }) }))
  })
  it.each([AppRole.MEMBER, AppRole.COACH, AppRole.MERCHANT, AppRole.FINANCE])('rejects unauthorized directory access: %s', async role => {
    const prisma: any = { user: { findMany: vi.fn() } }
    await expect(new MembersService(prisma).leadOwners(new LeadOwnerQueryDto(), { sub: 'user', displayName: '用户', roles: [role] })).rejects.toThrow('无权分配')
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})
