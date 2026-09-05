export const games = [{
  id: 'game-weekend', title: '周末进阶双打局', status: 'OPEN', level: 'INTERMEDIATE', capacity: 6,
  feeCents: 6800, startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400000 + 2 * 3600000).toISOString(), description: '适合有双打基础的球友。主理人现场分组，请提前到场热身，自带球拍和运动鞋。',
  host: { displayName: '周末主理人阿凯' }, _count: { registrations: 4 }, registrations: Array.from({ length: 4 }, (_, i) => ({ id: `reg-${i}`, userId: `player-${i}`, displayName: `球友${i + 1}`, status: i < 2 ? 'CHECKED_IN' : 'PAID' })),
}]

export const events = [
  {
    id: 'event-golden', name: '延庆金羽积分赛·秋季站', status: 'IN_PROGRESS', minimumPeople: 24, capacityPeople: 48,
    totalRounds: 5, currentRound: 2, feeCents: 9900, startsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
  {
    id: 'event-finished', code: 'EV-FINISHED-2026', name: '延庆金羽积分赛·完赛验收场', status: 'COMPLETED',
    minimumPeople: 24, capacityPeople: 48, totalRounds: 5, currentRound: 5, feeCents: 9900,
    startsAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    prizePool: { champion: '冠军奖：训练羽毛球', runnerUp: '亚军奖：专业手胶' },
  },
  {
    id: 'event-open-partner', code: 'EV-PARTNER-OPEN', name: '延庆金羽固定双打公开赛', status: 'OPEN',
    minimumPeople: 24, capacityPeople: 48, totalRounds: 5, currentRound: 0, feeCents: 9900,
    memberFeeCents: 7900,
    registrationEndsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    startsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
  },
]

export const trainingProducts = [
  { id: 'training-adult', name: '成人进阶双打课包', audience: 'ADULT', totalSessions: 12, validityDays: 120, priceCents: 128000, classes: [{ id: 'class-adult', name: '周三晚进阶班', capacity: 12 }] },
  { id: 'training-youth', name: '青少年成长课包', audience: 'YOUTH', totalSessions: 20, validityDays: 180, priceCents: 198000, classes: [{ id: 'class-youth', name: '周末青少年班', capacity: 20 }] },
]

export const enrollments = [{ id: 'enroll-1', enrollmentNo: 'EN202608001', classId: 'class-adult', status: 'ACTIVE', totalSessions: 12, usedSessions: 3, consumedSessions: 3, prepaidBalanceCents: 96_000, expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), product: trainingProducts[0], buyerId: 'user-member', studentId: null, buyer: { displayName: '延庆会员小林' }, attendances: [{ id: 'attendance-1', sessionId: 'session-1', status: 'PENDING', consumedSessions: 0, operatorId: null, feedback: null }, { id: 'attendance-current', sessionId: 'session-current', status: 'PENDING', consumedSessions: 0, operatorId: null, feedback: null }] }]

const seededTrainingStartsAt = new Date(Date.now() + 86400000)
// Rolling acceptance fixture: the lesson has just ended, so attendance can
// still be recorded and the two-person consume confirmation can run onsite.
const currentTrainingStartsAt = new Date(Date.now() - 150 * 60000)
export const trainingSessions = [
  { id: 'session-1', classId: 'class-adult', status: 'SCHEDULED', startsAt: seededTrainingStartsAt.toISOString(), endsAt: new Date(seededTrainingStartsAt.getTime() + 2 * 3600000).toISOString(), courtIds: ['court-1'], occupiedCourtHours: 2, class: { name: '周三晚进阶班' } },
  { id: 'session-current', classId: 'class-adult', status: 'IN_PROGRESS', startsAt: currentTrainingStartsAt.toISOString(), endsAt: new Date(currentTrainingStartsAt.getTime() + 2 * 3600000).toISOString(), courtIds: ['court-2'], occupiedCourtHours: 2, class: { name: '周三晚进阶班' } },
]

export const merchants = [{ id: 'merchant-coffee', name: '山脚咖啡', category: '餐饮', _count: { couponTemplates: 1, couponRedemptions: 12 } }, { id: 'merchant-outdoor', name: '延庆户外社', category: '户外', _count: { couponTemplates: 1, couponRedemptions: 4 } }]
export const coupons = [{ id: 'coupon-1', code: 'YQ-COFFEE-2026', status: 'AVAILABLE', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), template: { merchant: merchants[0], benefitDescription: '羽毛球会员专享咖啡立减20元', faceValueCents: 2000 } }]

export const membershipProducts = [
  {
    id: 'member-regular', code: 'MEMBER_REGULAR_YEAR', version: 1, level: 'REGULAR', name: '年度会员',
    durationDays: 365, priceCents: 29900, benefits: { booking: '提前7天订场', discount: '场地95折' },
    effectiveFrom: '2026-01-01T00:00:00+08:00', effectiveTo: '2099-01-01T00:00:00+08:00', enabled: true,
    createdById: 'user-admin', createdBy: { id: 'user-admin', displayName: '金羽管理员' }, transitions: [],
    createdAt: '2026-01-01T00:00:00+08:00', updatedAt: '2026-01-01T00:00:00+08:00',
  },
  {
    id: 'member-gold', code: 'MEMBER_GOLD_YEAR', version: 1, level: 'GOLD', name: '金卡会员',
    durationDays: 365, priceCents: 69900, benefits: { booking: '提前14天订场', discount: '场地9折', guest: '每月同行券' },
    effectiveFrom: '2026-01-01T00:00:00+08:00', effectiveTo: '2099-01-01T00:00:00+08:00', enabled: true,
    createdById: 'user-admin', createdBy: { id: 'user-admin', displayName: '金羽管理员' }, transitions: [],
    createdAt: '2026-01-01T00:00:00+08:00', updatedAt: '2026-01-01T00:00:00+08:00',
  },
]

export const goods = [
  { id: 'goods-ball', sku: 'BALL-001', name: '金羽训练羽毛球', category: '羽毛球', mode: 'PURCHASE', stock: 36, safeStock: 20, supplier: '北京羽联', purchasePriceCents: 6800, salePriceCents: 8800 },
  { id: 'goods-grip', sku: 'GRIP-001', name: '专业吸汗手胶', category: '手胶', mode: 'CONSIGNMENT', stock: 8, safeStock: 10, supplier: '延庆户外社', purchasePriceCents: 800, salePriceCents: 1500 },
  { id: 'goods-drink', sku: 'DRINK-001', name: '运动电解质饮料', category: '饮品', mode: 'PURCHASE', stock: 42, safeStock: 15, supplier: '本地饮品站', purchasePriceCents: 400, salePriceCents: 800 },
]
