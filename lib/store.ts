'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { buildSeedState, DEMO_TODAY } from './seed'
import { round2, trainingContractRate } from './finance'
import { buildNextRound, BYE_ID, eventPointsForRank, rankPairs, recomputeStandings } from './swiss'
import type {
  AuditLog,
  CouponCode,
  CouponTemplate,
  DemoState,
  FlowKey,
  LedgerEntry,
  Member,
  Order,
  PayChannel,
  RoleKey,
  SourceChannel,
} from './types'

let seq = Date.now() % 100000
const nextId = (prefix: string) => `${prefix}${(seq++).toString(36).toUpperCase()}`

export const demoNow = (): string => {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${DEMO_TODAY} ${hh}:${mm}`
}

export interface ActionResult {
  ok: boolean
  message: string
  id?: string
}

/** 五类账户，严格分开不可互相冲抵（FR-05） */
export type AccountKind = '现金本金余额' | '赠送余额' | '羽球币' | '成人赛事积分' | '青少年成长积分'

interface Actions {
  setRole: (role: RoleKey) => void
  setCurrentMember: (id: string) => void
  setCurrentMerchant: (id: string) => void
  resetDemo: () => void
  markFlow: (flow: FlowKey, step: string) => void
  addAudit: (log: Omit<AuditLog, 'id' | 'at'>) => void

  // 闭环一
  claimNewbieCoupon: (memberId: string) => ActionResult
  createVenueOrder: (input: {
    memberId: string
    date: string
    courtId: string
    slotId: string
    amount: number
    payChannel: PayChannel
    sourceChannel: SourceChannel
    couponCode?: string
  }) => ActionResult
  payOrder: (orderId: string) => ActionResult
  checkInOrder: (orderId: string, operator: string) => ActionResult
  refundVenueOrder: (orderId: string, operator: string, reason: string) => ActionResult

  // 闭环二
  registerEventPair: (input: {
    eventId: string
    playerA: string
    playerB: string
    memberIds: string[]
    payChannel: PayChannel
  }) => ActionResult
  checkInEventPair: (eventId: string, pairId: string) => ActionResult
  checkInAllPairs: (eventId: string) => ActionResult
  startNextRound: (eventId: string) => ActionResult
  submitMatchScore: (eventId: string, matchId: string, scoreA: number, scoreB: number) => ActionResult
  correctMatchScore: (
    eventId: string,
    matchId: string,
    scoreA: number,
    scoreB: number,
    operator: string,
    reason: string,
  ) => ActionResult
  finishEvent: (eventId: string) => ActionResult

  // 闭环三
  purchaseTraining: (input: {
    courseId: string
    memberId: string
    studentName: string
    guardian: string
    guardianPhone: string
  }) => ActionResult
  consumeTrainingSession: (enrollmentId: string, operator: string) => ActionResult
  refundTraining: (enrollmentId: string, sessions: number, operator: string) => ActionResult

  // 闭环四
  createCouponTemplate: (input: {
    name: string
    merchantId: string
    activity: string
    benefit: string
    faceValue: number
    validFrom: string
    validTo: string
    issuedCount: number
    note: string
  }) => ActionResult
  claimCouponFromTemplate: (templateId: string, memberId: string) => ActionResult
  redeemCouponCode: (code: string, merchantId: string, operator: string, amount: number) => ActionResult
  settleMerchant: (merchantId: string, operator: string) => ActionResult

  // 后台
  updateParam: (key: string, value: string, effectiveFrom: string, actor: string) => ActionResult
  adjustAccount: (
    memberId: string,
    account: AccountKind,
    delta: number,
    reason: string,
    operator: string,
  ) => ActionResult
}

export type DemoStore = DemoState & Actions

const pushLedger = (state: DemoState, entry: Omit<LedgerEntry, 'id'>) => {
  state.ledger = [{ ...entry, id: nextId('LG') }, ...state.ledger]
}

const pushAudit = (state: DemoState, log: Omit<AuditLog, 'id' | 'at'>) => {
  state.auditLogs = [{ ...log, id: nextId('AL'), at: demoNow() }, ...state.auditLogs]
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const useDemoStore = create<DemoStore>()(
  persist(
    (set, get) => ({
      ...buildSeedState(),

      setRole: (role) => set({ role }),
      setCurrentMember: (id) => set({ currentMemberId: id }),
      setCurrentMerchant: (id) => set({ currentMerchantId: id }),
      resetDemo: () => set({ ...buildSeedState() }),

      markFlow: (flow, step) =>
        set((s) => ({
          flows: { ...s.flows, [flow]: { steps: { ...s.flows[flow].steps, [step]: true } } },
        })),

      addAudit: (log) =>
        set((s) => {
          const next = clone(s) as DemoState
          pushAudit(next, log)
          return { auditLogs: next.auditLogs }
        }),

      // ===== 闭环一：新客体验与订场 =====
      claimNewbieCoupon: (memberId) => {
        const s = get()
        const member = s.members.find((m) => m.id === memberId)
        if (!member) return { ok: false, message: '未找到会员档案' }
        const existing = s.couponCodes.find(
          (c) => c.templateId === 'CT01' && c.memberId === memberId && c.status !== 'expired',
        )
        if (existing) {
          return { ok: false, message: `该会员已领取新客体验券（券码 ${existing.code}），每人限领1张`, id: existing.id }
        }
        const code = `YQ-XK-${8800 + s.couponCodes.filter((c) => c.templateId === 'CT01').length + 1}`
        const newCode: CouponCode = {
          id: nextId('CC'),
          templateId: 'CT01',
          code,
          status: 'claimed',
          memberId,
          memberName: member.name,
          claimedAt: demoNow(),
        }
        set((st) => ({ couponCodes: [newCode, ...st.couponCodes] }))
        get().markFlow('flow1', 'claim')
        return { ok: true, message: `已领取新客体验券 ${code}`, id: newCode.id }
      },

      createVenueOrder: ({ memberId, date, courtId, slotId, amount, payChannel, sourceChannel, couponCode }) => {
        const s = get()
        const member = s.members.find((m) => m.id === memberId)
        const court = s.courts.find((c) => c.id === courtId)
        const slot = s.slots.find((x) => x.id === slotId)
        if (!member || !court || !slot) return { ok: false, message: '订单信息不完整' }
        const conflict = s.orders.find(
          (o) =>
            o.businessType === 'venue' &&
            o.date === date &&
            o.courtId === courtId &&
            o.slotId === slotId &&
            o.status !== 'refunded' &&
            o.status !== 'cancelled',
        )
        if (conflict) return { ok: false, message: `${court.name} ${slot.label} 已被预订，请重新选择` }
        const id = `VN${date.replace(/-/g, '')}${String(s.orders.length + 1).padStart(3, '0')}`
        const order: Order = {
          id,
          businessType: 'venue',
          subject: '球馆本部',
          payChannel,
          sourceChannel,
          memberId,
          memberName: member.name,
          title: `${court.name} ${slot.label} ${couponCode ? '新客体验场' : '场地预订'}`,
          amount,
          status: 'pending',
          createdAt: demoNow(),
          date,
          courtId,
          slotId,
          qrCode: `YQ-VN-${date.slice(5).replace('-', '')}-${courtId.slice(1)}${slotId.slice(1)}`,
          couponCode,
        }
        set((st) => ({ orders: [order, ...st.orders] }))
        get().markFlow('flow1', 'select')
        return { ok: true, message: '订单已创建，待支付', id }
      },

      payOrder: (orderId) => {
        const s = get()
        const order = s.orders.find((o) => o.id === orderId)
        if (!order) return { ok: false, message: '订单不存在' }
        if (order.status !== 'pending') return { ok: false, message: '该订单已支付，重复支付被拦截' }
        const next = clone(s) as DemoState
        const target = next.orders.find((o) => o.id === orderId)!
        target.status = 'paid'
        // 券抵扣：核销对应券码
        if (target.couponCode) {
          const cc = next.couponCodes.find((c) => c.code === target.couponCode)
          if (cc && cc.status === 'claimed') {
            cc.status = 'redeemed'
            cc.redeemedAt = demoNow()
            cc.redeemedBy = '小程序系统自动抵扣'
            cc.attributedAmount = target.amount
          }
        }
        // 账户扣减
        if (target.payChannel === '现金余额' || target.payChannel === '赠送余额') {
          const m = next.members.find((x) => x.id === target.memberId)
          if (m) {
            if (target.payChannel === '现金余额') {
              if (m.cashBalance < target.amount) return { ok: false, message: '现金本金余额不足' }
              m.cashBalance = round2(m.cashBalance - target.amount)
              next.txns = [
                {
                  id: nextId('TX'),
                  memberId: m.id,
                  account: '现金本金余额',
                  delta: -target.amount,
                  balanceAfter: m.cashBalance,
                  reason: target.title,
                  at: demoNow(),
                  orderId: target.id,
                },
                ...next.txns,
              ]
            } else {
              if (m.giftBalance < target.amount) return { ok: false, message: '赠送余额不足' }
              m.giftBalance = round2(m.giftBalance - target.amount)
              next.txns = [
                {
                  id: nextId('TX'),
                  memberId: m.id,
                  account: '赠送余额',
                  delta: -target.amount,
                  balanceAfter: m.giftBalance,
                  reason: target.title,
                  at: demoNow(),
                  orderId: target.id,
                },
                ...next.txns,
              ]
            }
          }
        }
        pushLedger(next, {
          at: demoNow(),
          businessType: target.businessType,
          subject: target.subject,
          payChannel: target.payChannel,
          sourceChannel: target.sourceChannel,
          amount: target.amount,
          title: target.title,
          orderId: target.id,
          kind: '业务收款',
        })
        // 一层直接推荐奖励，进入退款观察期
        const member = next.members.find((m) => m.id === target.memberId)
        if (member?.referrerId && target.businessType === 'venue') {
          const already = next.referrals.some((r) => r.inviteeId === member.id)
          if (!already) {
            const referrer = next.members.find((m) => m.id === member.referrerId)
            const rewardCoins = Number(next.params.find((p) => p.key === 'referral.reward_coins')?.value ?? 300)
            const days = Number(next.params.find((p) => p.key === 'referral.observe_days')?.value ?? 7)
            next.referrals = [
              {
                id: nextId('RF'),
                referrerId: referrer?.id ?? '',
                referrerName: referrer?.name ?? '未知',
                inviteeId: member.id,
                inviteeName: member.name,
                orderId: target.id,
                rewardCoins,
                status: '待观察期结束',
                createdAt: demoNow(),
                releaseAt: `观察期 ${days} 天后发放`,
                note: '仅一层直接推荐，无二级推荐人与多级佣金',
              },
              ...next.referrals,
            ]
          }
        }
        set({
          orders: next.orders,
          couponCodes: next.couponCodes,
          members: next.members,
          txns: next.txns,
          ledger: next.ledger,
          referrals: next.referrals,
        })
        get().markFlow('flow1', 'pay')
        return { ok: true, message: '模拟支付成功，已生成签到二维码' }
      },

      checkInOrder: (orderId, operator) => {
        const s = get()
        const order = s.orders.find((o) => o.id === orderId)
        if (!order) return { ok: false, message: '订单不存在' }
        if (order.status === 'checked_in' || order.status === 'completed')
          return { ok: false, message: '该订单已签到，重复签到被拦截' }
        if (order.status !== 'paid') return { ok: false, message: '订单未支付，无法签到' }
        const next = clone(s) as DemoState
        const target = next.orders.find((o) => o.id === orderId)!
        target.status = 'checked_in'
        target.checkedInAt = demoNow()
        const m = next.members.find((x) => x.id === target.memberId)
        if (m) {
          m.lastVisitAt = DEMO_TODAY
          m.visits30d += 1
        }
        pushAudit(next, {
          actor: operator,
          role: '员工',
          action: '场地签到核验',
          target: `订单 ${target.id}`,
          before: '已支付',
          after: '已签到入场',
        })
        set({ orders: next.orders, members: next.members, auditLogs: next.auditLogs })
        get().markFlow('flow1', 'checkin')
        return { ok: true, message: `${target.memberName} 签到成功，闸机已放行（模拟）` }
      },

      refundVenueOrder: (orderId, operator, reason) => {
        const s = get()
        const order = s.orders.find((o) => o.id === orderId)
        if (!order) return { ok: false, message: '订单不存在' }
        if (order.status === 'refunded') return { ok: false, message: '该订单已退款，重复退款被拦截' }
        const next = clone(s) as DemoState
        const target = next.orders.find((o) => o.id === orderId)!
        target.status = 'refunded'
        target.refundedAt = demoNow()
        target.refundAmount = target.amount
        target.note = reason
        pushLedger(next, {
          at: demoNow(),
          businessType: target.businessType,
          subject: target.subject,
          payChannel: target.payChannel,
          sourceChannel: target.sourceChannel,
          amount: -target.amount,
          title: `${target.title} 退款`,
          orderId: target.id,
          kind: '退款',
        })
        pushAudit(next, {
          actor: operator,
          role: '员工',
          action: '订场退款',
          target: `订单 ${target.id}`,
          before: '已支付',
          after: `已退款 ¥${target.amount}`,
          note: reason,
        })
        set({ orders: next.orders, ledger: next.ledger, auditLogs: next.auditLogs })
        return { ok: true, message: '退款成功，已记录操作日志' }
      },

      // ===== 闭环二：瑞士积分赛事 =====
      registerEventPair: ({ eventId, playerA, playerB, memberIds, payChannel }) => {
        const s = get()
        const ev = s.events.find((e) => e.id === eventId)
        if (!ev) return { ok: false, message: '赛事不存在' }
        if (ev.currentRound > 0) return { ok: false, message: '赛事已开赛，报名通道已关闭' }
        if (ev.pairs.length * 2 >= ev.capacity) return { ok: false, message: `报名已达 ${ev.capacity} 人封顶` }
        const dup = ev.pairs.find((p) => p.playerA === playerA || p.playerB === playerA || p.playerA === playerB || p.playerB === playerB)
        if (dup) return { ok: false, message: `${dup.playerA} / ${dup.playerB} 中已有选手报名，重复报名被拦截` }
        const next = clone(s) as DemoState
        const target = next.events.find((e) => e.id === eventId)!
        const pairId = `P${String(target.pairs.length + 1).padStart(2, '0')}`
        target.pairs.push({
          id: pairId,
          playerA,
          playerB,
          memberIds,
          seed: target.pairs.length + 1,
          points: 0,
          wins: 0,
          losses: 0,
          scoreDiff: 0,
          paid: true,
          checkedIn: false,
          opponents: [],
        })
        const orderId = `EV${DEMO_TODAY.replace(/-/g, '')}${String(next.orders.length + 1).padStart(3, '0')}`
        next.orders = [
          {
            id: orderId,
            businessType: 'event',
            subject: '球馆本部',
            payChannel,
            sourceChannel: '小程序自然流量',
            memberId: memberIds[0] ?? next.currentMemberId,
            memberName: playerA,
            title: `${target.name}（组合：${playerA} / ${playerB}）`,
            amount: target.fee,
            status: 'paid',
            createdAt: demoNow(),
          },
          ...next.orders,
        ]
        pushLedger(next, {
          at: demoNow(),
          businessType: 'event',
          subject: '球馆本部',
          payChannel,
          sourceChannel: '小程序自然流量',
          amount: target.fee,
          title: `赛事报名费 ${playerA}/${playerB}`,
          orderId,
          kind: '业务收款',
        })
        set({ events: next.events, orders: next.orders, ledger: next.ledger })
        get().markFlow('flow2', 'register')
        get().markFlow('flow2', 'pay')
        return { ok: true, message: `报名成功，组合 ${playerA} / ${playerB}（${pairId}）`, id: pairId }
      },

      checkInEventPair: (eventId, pairId) => {
        const s = get()
        const ev = s.events.find((e) => e.id === eventId)
        const pair = ev?.pairs.find((p) => p.id === pairId)
        if (!ev || !pair) return { ok: false, message: '组合不存在' }
        if (pair.checkedIn) return { ok: false, message: '该组合已签到，重复签到被拦截' }
        const next = clone(s) as DemoState
        const t = next.events.find((e) => e.id === eventId)!.pairs.find((p) => p.id === pairId)!
        t.checkedIn = true
        set({ events: next.events })
        get().markFlow('flow2', 'checkin')
        return { ok: true, message: `${pair.playerA} / ${pair.playerB} 已签到` }
      },

      checkInAllPairs: (eventId) => {
        const s = get()
        const next = clone(s) as DemoState
        const ev = next.events.find((e) => e.id === eventId)
        if (!ev) return { ok: false, message: '赛事不存在' }
        let count = 0
        ev.pairs.forEach((p) => {
          if (!p.checkedIn) {
            p.checkedIn = true
            count++
          }
        })
        set({ events: next.events })
        get().markFlow('flow2', 'checkin')
        return { ok: count > 0, message: count > 0 ? `已为 ${count} 个组合完成批量签到` : '所有组合均已签到' }
      },

      startNextRound: (eventId) => {
        const s = get()
        const ev = s.events.find((e) => e.id === eventId)
        if (!ev) return { ok: false, message: '赛事不存在' }
        if (ev.currentRound >= ev.totalRounds) return { ok: false, message: '5轮瑞士制已全部完成' }
        const pending = ev.matches.filter((m) => m.round === ev.currentRound && !m.confirmed)
        if (pending.length > 0) return { ok: false, message: `第${ev.currentRound}轮还有 ${pending.length} 场比分未录入` }
        const checked = ev.pairs.filter((p) => p.checkedIn)
        if (checked.length < 2) return { ok: false, message: '签到组合不足，无法编排对阵' }
        const next = clone(s) as DemoState
        const target = next.events.find((e) => e.id === eventId)!
        const { matches, byePairId } = buildNextRound(target)
        target.matches.push(...matches)
        target.currentRound += 1
        target.status = '进行中'
        if (byePairId) {
          const bp = target.pairs.find((p) => p.id === byePairId)!
          bp.opponents.push(BYE_ID)
          bp.points += 1
        }
        set({ events: next.events })
        get().markFlow('flow2', 'round')
        return {
          ok: true,
          message: `第${target.currentRound}轮编排完成，共 ${matches.length} 台${byePairId ? '，1个组合轮空计1分' : ''}`,
        }
      },

      submitMatchScore: (eventId, matchId, scoreA, scoreB) => {
        const s = get()
        const ev = s.events.find((e) => e.id === eventId)
        const match = ev?.matches.find((m) => m.id === matchId)
        if (!ev || !match) return { ok: false, message: '场次不存在' }
        if (match.confirmed) return { ok: false, message: '该场比分已确认，如需更改请使用人工修正' }
        if (scoreA === scoreB) return { ok: false, message: '羽毛球比赛不允许平分，请核对比分' }
        if (Math.max(scoreA, scoreB) < 21 || Math.max(scoreA, scoreB) > 30)
          return { ok: false, message: '单局比分应在 21-30 之间' }
        const next = clone(s) as DemoState
        const target = next.events.find((e) => e.id === eventId)!
        const m = target.matches.find((x) => x.id === matchId)!
        m.scoreA = scoreA
        m.scoreB = scoreB
        m.confirmed = true
        target.pairs = recomputeStandings(target)
        set({ events: next.events })
        get().markFlow('flow2', 'score')
        return { ok: true, message: '比分已录入，积分与排名已更新' }
      },

      correctMatchScore: (eventId, matchId, scoreA, scoreB, operator, reason) => {
        const s = get()
        const ev = s.events.find((e) => e.id === eventId)
        const match = ev?.matches.find((m) => m.id === matchId)
        if (!ev || !match) return { ok: false, message: '场次不存在' }
        if (!match.confirmed) return { ok: false, message: '该场尚未录入比分，请先录入' }
        if (scoreA === scoreB) return { ok: false, message: '羽毛球比赛不允许平分，请核对比分' }
        const next = clone(s) as DemoState
        const target = next.events.find((e) => e.id === eventId)!
        const m = target.matches.find((x) => x.id === matchId)!
        const before = `${m.scoreA}:${m.scoreB}`
        m.scoreA = scoreA
        m.scoreB = scoreB
        m.corrected = true
        target.pairs = recomputeStandings(target)
        pushAudit(next, {
          actor: operator,
          role: '管理员',
          action: '人工修正比分',
          target: `${target.name} 第${m.round}轮 ${m.court}`,
          before,
          after: `${scoreA}:${scoreB}`,
          note: reason,
        })
        set({ events: next.events, auditLogs: next.auditLogs })
        get().markFlow('flow2', 'correct')
        return { ok: true, message: '比分已修正并生成操作日志' }
      },

      finishEvent: (eventId) => {
        const s = get()
        const ev = s.events.find((e) => e.id === eventId)
        if (!ev) return { ok: false, message: '赛事不存在' }
        if (ev.currentRound < ev.totalRounds) return { ok: false, message: `还需完成第${ev.currentRound + 1}轮及之后轮次` }
        if (ev.matches.some((m) => !m.confirmed)) return { ok: false, message: '仍有场次比分未录入' }
        if (ev.status === '已结束') return { ok: false, message: '该赛事已结算，重复结算被拦截' }
        const next = clone(s) as DemoState
        const target = next.events.find((e) => e.id === eventId)!
        target.status = '已结束'
        const ranked = rankPairs(target.pairs.filter((p) => p.checkedIn))
        ranked.forEach((p, idx) => {
          const gained = eventPointsForRank(idx + 1, ranked.length)
          p.memberIds.forEach((mid) => {
            const m = next.members.find((x) => x.id === mid)
            if (m) {
              m.eventPoints += gained
              next.txns = [
                {
                  id: nextId('TX'),
                  memberId: mid,
                  account: '成人赛事积分',
                  delta: gained,
                  balanceAfter: m.eventPoints,
                  reason: `${target.name} 第${idx + 1}名`,
                  at: demoNow(),
                },
                ...next.txns,
              ]
            }
            const member = next.members.find((x) => x.id === mid)
            next.eventHistory = [
              {
                id: nextId('EH'),
                memberId: mid,
                memberName: member?.name ?? p.playerA,
                eventName: target.name,
                date: target.date,
                rank: idx + 1,
                totalPairs: ranked.length,
                wins: p.wins,
                losses: p.losses,
                pointsGained: gained,
              },
              ...next.eventHistory,
            ]
          })
        })
        set({ events: next.events, members: next.members, txns: next.txns, eventHistory: next.eventHistory })
        get().markFlow('flow2', 'finish')
        return { ok: true, message: '赛事已结算，赛事积分与历史战绩已写入会员档案' }
      },

      // ===== 闭环三：培训 =====
      purchaseTraining: ({ courseId, memberId, studentName, guardian, guardianPhone }) => {
        const s = get()
        const course = s.courses.find((c) => c.id === courseId)
        const member = s.members.find((m) => m.id === memberId)
        if (!course || !member) return { ok: false, message: '课程或会员信息不存在' }
        const next = clone(s) as DemoState
        const enId = nextId('EN')
        next.enrollments = [
          {
            id: enId,
            courseId,
            memberId,
            studentName,
            guardian,
            guardianPhone,
            totalSessions: course.totalSessions,
            usedSessions: 0,
            unitPrice: course.unitPrice,
            paidAmount: course.price,
            confirmedRevenue: 0,
            unusedBalance: course.price,
            status: '在读',
            refundAmount: 0,
            createdAt: DEMO_TODAY,
          },
          ...next.enrollments,
        ]
        const orderId = `TR${DEMO_TODAY.replace(/-/g, '')}${String(next.orders.length + 1).padStart(3, '0')}`
        next.orders = [
          {
            id: orderId,
            businessType: 'training',
            subject: '培训中心',
            payChannel: '微信支付',
            sourceChannel: '小程序自然流量',
            memberId,
            memberName: member.name,
            title: `${course.name} ${course.totalSessions}课次（学员：${studentName}）`,
            amount: course.price,
            status: 'completed',
            createdAt: demoNow(),
            note: '培训独立账套：全额进入预收，未消课不确认收入',
          },
          ...next.orders,
        ]
        set({ enrollments: next.enrollments, orders: next.orders })
        get().markFlow('flow3', 'purchase')
        return { ok: true, message: `报名成功，预收 ¥${course.price} 已计入培训中心账套`, id: enId }
      },

      consumeTrainingSession: (enrollmentId, operator) => {
        const s = get()
        const en = s.enrollments.find((e) => e.id === enrollmentId)
        if (!en) return { ok: false, message: '报名记录不存在' }
        if (en.usedSessions >= en.totalSessions - Math.round(en.refundAmount / en.unitPrice))
          return { ok: false, message: '可用课次已全部消耗，无法继续消课' }
        const course = s.courses.find((c) => c.id === en.courseId)
        if (!course) return { ok: false, message: '课程不存在' }
        const next = clone(s) as DemoState
        const target = next.enrollments.find((e) => e.id === enrollmentId)!
        target.usedSessions += 1
        target.confirmedRevenue = round2(target.confirmedRevenue + target.unitPrice)
        target.unusedBalance = round2(Math.max(0, target.unusedBalance - target.unitPrice))
        if (target.unusedBalance === 0 && target.status === '在读') target.status = '已结课'
        next.sessionLogs = [
          {
            id: nextId('SL'),
            enrollmentId,
            courseId: en.courseId,
            studentName: en.studentName,
            date: DEMO_TODAY,
            courtCount: course.courtCountPerSession,
            hours: course.hoursPerSession,
            confirmedAmount: target.unitPrice,
            coachCost: course.coachCostPerSession,
            materialCost: course.materialCostPerSession,
            operator,
            at: demoNow(),
          },
          ...next.sessionLogs,
        ]
        // 培训确认收入 + 按比例生成"计入球馆流水"（不生成场地费）
        const rate = trainingContractRate(next.params)
        pushLedger(next, {
          at: demoNow(),
          businessType: 'training',
          subject: '培训中心',
          payChannel: '微信支付',
          sourceChannel: '小程序自然流量',
          amount: target.unitPrice,
          title: `${en.studentName} 第${target.usedSessions}次课消课确认收入`,
          kind: '培训确认收入',
        })
        pushLedger(next, {
          at: demoNow(),
          businessType: 'training',
          subject: '球馆本部',
          payChannel: '微信支付',
          sourceChannel: '小程序自然流量',
          amount: round2(target.unitPrice * rate),
          title: `培训有效流水×${Math.round(rate * 100)}% 计入球馆合同流水（场地费0元）`,
          kind: '计入球馆流水',
        })
        // 青少年成长积分
        if (course.audience === '青少年') {
          const m = next.members.find((x) => x.id === en.memberId)
          if (m) {
            m.growthPoints += 20
            next.txns = [
              {
                id: nextId('TX'),
                memberId: m.id,
                account: '青少年成长积分',
                delta: 20,
                balanceAfter: m.growthPoints,
                reason: `学员${en.studentName}完成第${target.usedSessions}次课签到`,
                at: demoNow(),
              },
              ...next.txns,
            ]
          }
        }
        pushAudit(next, {
          actor: operator,
          role: '教练',
          action: '培训签到消课',
          target: `${en.studentName} · ${course.name}`,
          before: `已消课 ${en.usedSessions}/${en.totalSessions}`,
          after: `已消课 ${target.usedSessions}/${target.totalSessions}`,
        })
        set({
          enrollments: next.enrollments,
          sessionLogs: next.sessionLogs,
          ledger: next.ledger,
          members: next.members,
          txns: next.txns,
          auditLogs: next.auditLogs,
        })
        get().markFlow('flow3', 'consume')
        return { ok: true, message: `消课成功，确认收入 ¥${target.unitPrice}，同步生成 ${Math.round(rate * 100)}% 合同流水` }
      },

      refundTraining: (enrollmentId, sessions, operator) => {
        const s = get()
        const en = s.enrollments.find((e) => e.id === enrollmentId)
        if (!en) return { ok: false, message: '报名记录不存在' }
        const remain = en.totalSessions - en.usedSessions - Math.round(en.refundAmount / en.unitPrice)
        if (sessions <= 0) return { ok: false, message: '退费课次必须大于 0' }
        if (sessions > remain) return { ok: false, message: `未消课次仅剩 ${remain} 次，退费课次超限` }
        const amount = round2(sessions * en.unitPrice)
        const next = clone(s) as DemoState
        const target = next.enrollments.find((e) => e.id === enrollmentId)!
        target.refundAmount = round2(target.refundAmount + amount)
        target.unusedBalance = round2(Math.max(0, target.unusedBalance - amount))
        target.status = target.unusedBalance === 0 ? '已退费' : '部分退费'
        pushLedger(next, {
          at: demoNow(),
          businessType: 'training',
          subject: '培训中心',
          payChannel: '微信支付',
          sourceChannel: '小程序自然流量',
          amount: -amount,
          title: `${en.studentName} 未消课退费 ${sessions} 次`,
          kind: '退款',
        })
        pushAudit(next, {
          actor: operator,
          role: '管理员',
          action: '培训退费',
          target: `${en.studentName} · ${enrollmentId}`,
          before: `未消课余额 ¥${en.unusedBalance}`,
          after: `未消课余额 ¥${target.unusedBalance}`,
          note: `退费 ${sessions} 次，仅退未消课部分，已确认收入不冲回`,
        })
        set({ enrollments: next.enrollments, ledger: next.ledger, auditLogs: next.auditLogs })
        get().markFlow('flow3', 'refund')
        return { ok: true, message: `已退费 ¥${amount}（仅未消课部分）` }
      },

      // ===== 闭环四：联盟券 =====
      createCouponTemplate: (input) => {
        const s = get()
        const merchant = s.merchants.find((m) => m.id === input.merchantId)
        if (!merchant) return { ok: false, message: '商户不存在' }
        if (!input.name.trim()) return { ok: false, message: '请填写券名称' }
        const next = clone(s) as DemoState
        const tid = nextId('CT')
        const template: CouponTemplate = {
          id: tid,
          name: input.name,
          merchantId: merchant.id,
          merchantName: merchant.name,
          activity: input.activity,
          benefit: input.benefit,
          faceValue: input.faceValue,
          validFrom: input.validFrom,
          validTo: input.validTo,
          issuedCount: input.issuedCount,
          status: '进行中',
          note: input.note,
        }
        next.couponTemplates = [template, ...next.couponTemplates]
        const prefix = merchant.isVenue ? 'YQ' : merchant.id
        for (let i = 0; i < Math.min(input.issuedCount, 3); i++) {
          next.couponCodes = [
            {
              id: nextId('CC'),
              templateId: tid,
              code: `${prefix}-${(seq + i).toString(36).toUpperCase().slice(-4)}-${1000 + i}`,
              status: 'issued',
            },
            ...next.couponCodes,
          ]
        }
        pushAudit(next, {
          actor: merchant.isVenue ? '运营 · 苏楠' : merchant.contact,
          role: merchant.isVenue ? '员工' : '联盟商户',
          action: '创建权益券',
          target: `${merchant.name} · ${input.name}`,
          after: `发券 ${input.issuedCount} 张，有效期 ${input.validFrom} 至 ${input.validTo}`,
        })
        set({ couponTemplates: next.couponTemplates, couponCodes: next.couponCodes, auditLogs: next.auditLogs })
        get().markFlow('flow4', 'create')
        return { ok: true, message: `已创建「${input.name}」并生成唯一券码`, id: tid }
      },

      claimCouponFromTemplate: (templateId, memberId) => {
        const s = get()
        const template = s.couponTemplates.find((t) => t.id === templateId)
        const member = s.members.find((m) => m.id === memberId)
        if (!template || !member) return { ok: false, message: '券或会员不存在' }
        const owned = s.couponCodes.find(
          (c) => c.templateId === templateId && c.memberId === memberId && c.status !== 'expired',
        )
        if (owned) return { ok: false, message: `已领取该权益券（${owned.code}），每人限领1张` }
        const next = clone(s) as DemoState
        const free = next.couponCodes.find((c) => c.templateId === templateId && c.status === 'issued')
        const codeStr =
          free?.code ?? `${template.merchantId}-${(seq++).toString(36).toUpperCase().slice(-4)}-${9000 + next.couponCodes.length}`
        if (free) {
          free.status = 'claimed'
          free.memberId = memberId
          free.memberName = member.name
          free.claimedAt = demoNow()
        } else {
          next.couponCodes = [
            {
              id: nextId('CC'),
              templateId,
              code: codeStr,
              status: 'claimed',
              memberId,
              memberName: member.name,
              claimedAt: demoNow(),
            },
            ...next.couponCodes,
          ]
        }
        set({ couponCodes: next.couponCodes })
        get().markFlow('flow4', 'claim')
        return { ok: true, message: `领取成功，券码 ${codeStr}` }
      },

      redeemCouponCode: (code, merchantId, operator, amount) => {
        const s = get()
        const cc = s.couponCodes.find((c) => c.code.toUpperCase() === code.trim().toUpperCase())
        if (!cc) return { ok: false, message: `券码 ${code} 不存在，请核对后重试` }
        const template = s.couponTemplates.find((t) => t.id === cc.templateId)
        if (!template) return { ok: false, message: '券模板已下线' }
        if (template.merchantId !== merchantId)
          return { ok: false, message: `该券属于「${template.merchantName}」，当前商户无权核销` }
        if (cc.status === 'redeemed')
          return {
            ok: false,
            message: `券码 ${cc.code} 已于 ${cc.redeemedAt} 由 ${cc.redeemedBy} 核销，重复核销已被拦截`,
          }
        if (cc.status === 'issued') return { ok: false, message: '该券尚未被会员领取，无法核销' }
        if (cc.status === 'expired') return { ok: false, message: '该券已过期' }
        if (template.validTo < DEMO_TODAY) return { ok: false, message: `该券有效期至 ${template.validTo}，已过期` }
        const next = clone(s) as DemoState
        const t = next.couponCodes.find((c) => c.id === cc.id)!
        t.status = 'redeemed'
        t.redeemedAt = demoNow()
        t.redeemedBy = operator
        t.attributedAmount = amount
        pushAudit(next, {
          actor: operator,
          role: template.merchantId === 'MC00' ? '员工' : '联盟商户',
          action: '券码核销',
          target: `${template.name} · ${cc.code}`,
          before: '已领取',
          after: `已核销，归因成交额 ¥${amount}`,
          note: '外部商户各自收款，球馆储值余额不可跨商户支付',
        })
        set({ couponCodes: next.couponCodes, auditLogs: next.auditLogs })
        get().markFlow('flow4', 'redeem')
        return { ok: true, message: `核销成功：${template.name}（${cc.code}）` }
      },

      settleMerchant: (merchantId, operator) => {
        const s = get()
        const merchant = s.merchants.find((m) => m.id === merchantId)
        if (!merchant) return { ok: false, message: '商户不存在' }
        if (merchant.settlementStatus === '已结算') return { ok: false, message: '该商户本期已结算，重复结算被拦截' }
        const next = clone(s) as DemoState
        const t = next.merchants.find((m) => m.id === merchantId)!
        const before = t.settlementStatus
        t.settlementStatus = '已结算'
        pushAudit(next, {
          actor: operator,
          role: '管理员',
          action: '联盟对账结算',
          target: merchant.name,
          before,
          after: '已结算',
          note: `合作费用 ¥${merchant.cooperationFee}，外部商户各自收款，仅做券码追踪与合同对账`,
        })
        set({ merchants: next.merchants, auditLogs: next.auditLogs })
        get().markFlow('flow4', 'settle')
        return { ok: true, message: `${merchant.name} 本期对账完成` }
      },

      // ===== 后台 =====
      updateParam: (key, value, effectiveFrom, actor) => {
        const s = get()
        const p = s.params.find((x) => x.key === key)
        if (!p) return { ok: false, message: '参数不存在' }
        if (p.locked) return { ok: false, message: p.lockReason ?? '该参数由合同锁定，不可修改' }
        if (!value.trim()) return { ok: false, message: '参数值不能为空' }
        if (value === p.value && effectiveFrom === p.effectiveFrom)
          return { ok: false, message: '参数值与生效日期均未变化' }
        const next = clone(s) as DemoState
        const t = next.params.find((x) => x.key === key)!
        const before = `${t.value}${t.unit}（生效 ${t.effectiveFrom}）`
        t.history = [{ value, effectiveFrom, changedBy: actor, changedAt: demoNow() }, ...t.history]
        t.value = value
        t.effectiveFrom = effectiveFrom
        pushAudit(next, {
          actor,
          role: '管理员',
          action: '修改关键参数',
          target: `${t.name}（${key}）`,
          before,
          after: `${value}${t.unit}（生效 ${effectiveFrom}）`,
          note: '历史订单按原参数留存，不受影响',
        })
        set({ params: next.params, auditLogs: next.auditLogs })
        return { ok: true, message: `${t.name} 已更新，自 ${effectiveFrom} 起生效` }
      },

      adjustAccount: (memberId, account, delta, reason, operator) => {
        const s = get()
        const member = s.members.find((m) => m.id === memberId)
        if (!member) return { ok: false, message: '会员不存在' }
        if (!delta) return { ok: false, message: '调整值不能为 0' }
        const next = clone(s) as DemoState
        const m = next.members.find((x) => x.id === memberId)!
        const map = {
          现金本金余额: 'cashBalance',
          赠送余额: 'giftBalance',
          羽球币: 'coins',
          成人赛事积分: 'eventPoints',
          青少年成长积分: 'growthPoints',
        } as const
        const field = map[account]
        const before = m[field]
        const after = round2(before + delta)
        if (after < 0) return { ok: false, message: `${account} 不足，调整后不可为负，且不同账户不可互相冲抵` }
        m[field] = after
        next.txns = [
          {
            id: nextId('TX'),
            memberId,
            account,
            delta,
            balanceAfter: after,
            reason: `${reason}（人工调整）`,
            at: demoNow(),
          },
          ...next.txns,
        ]
        pushAudit(next, {
          actor: operator,
          role: '管理员',
          action: `人工调整${account}`,
          target: `${member.name}（${memberId}）`,
          before: String(before),
          after: String(after),
          note: reason,
        })
        set({ members: next.members, txns: next.txns, auditLogs: next.auditLogs })
        return { ok: true, message: `${member.name} 的${account}已调整为 ${after}` }
      },
    }),
    {
      name: 'yanqing-jinyu-demo-v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)
