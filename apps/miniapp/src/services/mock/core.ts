import type { AppRole, SessionUser } from '../../types/domain'

const roleProfiles: Record<AppRole, { id: string; name: string; roles: AppRole[] }> = {
  MEMBER: { id: 'user-member', name: '延庆会员小林', roles: ['MEMBER'] },
  FRONT_DESK: { id: 'user-frontdesk', name: '前台小羽', roles: ['MEMBER', 'FRONT_DESK'] },
  COACH: { id: 'user-coach', name: '王教练', roles: ['MEMBER', 'COACH'] },
  HOST: { id: 'user-host', name: '周末主理人阿凯', roles: ['MEMBER', 'HOST'] },
  MERCHANT: { id: 'user-merchant', name: '山脚咖啡商户', roles: ['MEMBER', 'MERCHANT'] },
  FINANCE: { id: 'user-finance', name: '金羽财务', roles: ['MEMBER', 'FINANCE'] },
  EVENT_MANAGER: { id: 'user-event', name: '赛事管理员', roles: ['MEMBER', 'EVENT_MANAGER'] },
  ADMIN: { id: 'user-admin', name: '金羽管理员', roles: ['MEMBER', 'FRONT_DESK', 'FINANCE', 'EVENT_MANAGER', 'ADMIN'] },
  SUPER_ADMIN: { id: 'user-super', name: '超级管理员', roles: ['MEMBER', 'FRONT_DESK', 'FINANCE', 'EVENT_MANAGER', 'ADMIN', 'SUPER_ADMIN'] },
}

const accounts = [
  { id: 'account-cash', type: 'CASH_PRINCIPAL', balance: 128000, frozenBalance: 0 },
  { id: 'account-gift', type: 'GIFT_BALANCE', balance: 20000, frozenBalance: 0 },
  { id: 'account-coin', type: 'BADMINTON_COIN', balance: 500, frozenBalance: 0 },
  { id: 'account-event', type: 'EVENT_POINTS', balance: 126, frozenBalance: 0 },
  { id: 'account-growth', type: 'GROWTH_POINTS', balance: 860, frozenBalance: 0 },
]

export const roleOptions = Object.entries(roleProfiles).map(([role, profile]) => ({
  role: role as AppRole,
  label: profile.name,
  description: profile.roles.join(' / '),
}))

export function currentRole(): AppRole {
  return (uni.getStorageSync('yanqing_mock_role') as AppRole) || 'MEMBER'
}

export function setCurrentRole(role: AppRole) {
  uni.setStorageSync('yanqing_mock_role', role)
  uni.setStorageSync('yanqing_access_token', `mock-token-${role.toLowerCase()}`)
}

export function mockUser(role = currentRole()): SessionUser {
  const profile = roleProfiles[role] || roleProfiles.MEMBER
  return {
    id: profile.id,
    displayName: profile.name,
    primaryRole: role,
    roles: profile.roles,
    accounts: accounts.map((item) => ({ ...item })),
    memberProfile: { level: role === 'MEMBER' ? 'GOLD' : 'STAFF', phone: '13800000005' },
  }
}

export function mockLogin(role: AppRole) {
  setCurrentRole(role)
  return { accessToken: `mock-token-${role.toLowerCase()}`, user: mockUser(role) }
}
