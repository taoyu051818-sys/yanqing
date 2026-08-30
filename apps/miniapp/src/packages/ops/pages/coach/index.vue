<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import StatusBadge from '../../../../components/StatusBadge.vue'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import type { CourtAvailability } from '../../../../types/domain'
import { money, shortDate } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

const session = useSessionStore()
const lessons = ref<any[]>([])
const enrollments = ref<any[]>([])
const corrections = ref<any[]>([])
const products = ref<any[]>([])
const courtAvailability = ref<CourtAvailability | null>(null)
const loading = ref(false)
const actionKey = ref('')
const actionMessage = ref('')
const errorMessage = ref('')

const productCode = ref('')
const productName = ref('')
const productAudienceIndex = ref(0)
const productTotalSessions = ref('12')
const productValidityDays = ref('120')
const productPriceYuan = ref('1280')
const productReason = ref('')
const audienceOptions = [
  { label: '成人', value: 'ADULT' },
  { label: '青少年', value: 'YOUTH' },
]

const classCode = ref('')
const className = ref('')
const classProductIndex = ref(0)
const classWeekdayIndex = ref(2)
const classStartTime = ref('19:00')
const classEndTime = ref('21:00')
const classCapacity = ref('12')
const classCoachId = ref('user-coach')
const classAssistantId = ref('')
const classCoachCostYuan = ref('200')
const classAssistantCostYuan = ref('0')
const classMaterialCostYuan = ref('0')
const classReason = ref('')
const weekdayOptions = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const sessionClassIndex = ref(0)
const sessionDate = ref(shanghaiDate(1))
const sessionStartTime = ref('19:00')
const sessionEndTime = ref('21:00')
const selectedCourtIds = ref<string[]>([])
const sessionNote = ref('')
const sessionReason = ref('')

const mayViewTraining = computed(() =>
  session.roles.some((role) => ['COACH', 'FRONT_DESK', 'FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canConfigureTraining = computed(() =>
  session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canCreateSession = computed(() =>
  session.roles.some((role) => ['COACH', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canProposeConsume = computed(() =>
  session.roles.includes('COACH') &&
  !session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const roleLabel = computed(() => {
  if (session.roles.includes('SUPER_ADMIN')) return '超级管理员'
  if (session.roles.includes('ADMIN')) return '培训管理员'
  if (session.roles.includes('COACH')) return '教练'
  if (session.roles.includes('FINANCE')) return '财务只读'
  return '前台协作'
})
const isChecker = computed(() => session.roles.includes('ADMIN') || session.roles.includes('SUPER_ADMIN'))
const canMarkAttendance = computed(() =>
  session.roles.some((role) => ['COACH', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canRequestCorrection = computed(() =>
  session.roles.some((role) => ['COACH', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const requestedCorrections = computed(() => corrections.value.filter((item) => item.status === 'REQUESTED'))
const activeProducts = computed(() => products.value.filter((item) => item.enabled !== false))
const activeClasses = computed(() => activeProducts.value.flatMap((product) =>
  (product.classes || [])
    .filter((trainingClass: any) => trainingClass.active !== false)
    .map((trainingClass: any) => ({ ...trainingClass, product })),
))
const sessionClasses = computed(() => {
  const coachOnly = session.roles.includes('COACH') && !canConfigureTraining.value
  return coachOnly
    ? activeClasses.value.filter((trainingClass) =>
        trainingClass.coachId === session.user?.id || trainingClass.assistantId === session.user?.id,
      )
    : activeClasses.value
})
const selectedClassProduct = computed(() => activeProducts.value[classProductIndex.value] || null)
const selectedSessionClass = computed(() => sessionClasses.value[sessionClassIndex.value] || null)
const sessionCourts = computed(() => (courtAvailability.value?.courts || []).filter((court) => court.enabled))
const sessionStartsAt = computed(() => `${sessionDate.value}T${sessionStartTime.value}:00+08:00`)
const sessionEndsAt = computed(() => `${sessionDate.value}T${sessionEndTime.value}:00+08:00`)
const blockedCourtIds = computed(() => {
  const blocked = new Set<string>()
  const startsAt = new Date(sessionStartsAt.value).getTime()
  const endsAt = new Date(sessionEndsAt.value).getTime()
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return blocked
  for (const booking of courtAvailability.value?.bookings || []) {
    if (
      booking.status !== 'CANCELLED' &&
      new Date(booking.startsAt).getTime() < endsAt &&
      new Date(booking.endsAt).getTime() > startsAt
    ) blocked.add(booking.courtId)
  }
  for (const closure of courtAvailability.value?.closures || []) {
    if (
      closure.status === 'ACTIVE' &&
      new Date(closure.startsAt).getTime() < endsAt &&
      new Date(closure.endsAt).getTime() > startsAt
    ) blocked.add(closure.courtId)
  }
  return blocked
})

const activeLessons = computed(() => lessons.value.filter((item) => item.status !== 'COMPLETED'))
const activeStudents = computed(() =>
  enrollments.value.filter((item) => ['ACTIVE', 'PARTIALLY_REFUNDED'].includes(item.status)),
)
const metrics = computed(() => [
  ['今日课程', String(activeLessons.value.length), '按课表'],
  ['待签到学员', String(activeStudents.value.length), '可消课课包'],
  ['已消课', String(enrollments.value.reduce((total, item) => total + Number(item.usedSessions || 0), 0)), '累计课次'],
  ['待冲正复核', String(requestedCorrections.value.length), '不可变流水'],
])

async function load() {
  await session.hydrate()
  if (!mayViewTraining.value) {
    errorMessage.value = '当前账号没有培训经营页权限。'
    return
  }
  loading.value = true
  errorMessage.value = ''
  const result = await Promise.allSettled([
    endpoints.trainingSessions(),
    endpoints.adminEnrollments(),
    endpoints.trainingConsumeCorrections(),
    endpoints.trainingProducts(),
  ])
  if (result[0].status === 'fulfilled') lessons.value = result[0].value || []
  if (result[1].status === 'fulfilled') enrollments.value = result[1].value || []
  if (result[2].status === 'fulfilled') corrections.value = result[2].value || []
  if (result[3].status === 'fulfilled') products.value = result[3].value || []
  const failed = result.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined
  if (failed) errorMessage.value = failed.reason?.message || '部分培训经营数据加载失败。'
  if (classProductIndex.value >= activeProducts.value.length) classProductIndex.value = 0
  if (sessionClassIndex.value >= sessionClasses.value.length) sessionClassIndex.value = 0
  if (canCreateSession.value) await loadCourtAvailability()
  loading.value = false
}

function shanghaiDate(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function loadCourtAvailability() {
  try {
    courtAvailability.value = await endpoints.availability(sessionDate.value)
    selectedCourtIds.value = selectedCourtIds.value.filter((id) =>
      sessionCourts.value.some((court) => court.id === id),
    )
  } catch (cause: any) {
    errorMessage.value = cause?.message || '场地可用状态加载失败。'
  }
}

function requiredReason(value: string) {
  const reason = value.trim()
  if (reason.length < 2 || reason.length > 300) {
    throw new Error('创建原因必须填写 2-300 个字符。')
  }
  return reason
}

function positiveInteger(value: string, label: string, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须为 ${min}-${max} 的整数。`)
  }
  return parsed
}

function yuanToCents(value: string, label: string, positive = false) {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label}必须为非负金额，最多两位小数。`)
  }
  const cents = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(cents) || cents < (positive ? 1 : 0)) {
    throw new Error(`${label}${positive ? '必须大于 0' : '不能为负数'}。`)
  }
  return cents
}

async function runCreation(
  key: string,
  successMessage: string,
  operation: () => Promise<unknown>,
) {
  if (actionKey.value || loading.value) return false
  actionKey.value = key
  errorMessage.value = ''
  uni.showLoading({ title: '创建中', mask: true })
  try {
    await operation()
    actionMessage.value = successMessage
    await load()
    uni.showToast({ title: '创建成功', icon: 'success' })
    return true
  } catch (cause: any) {
    errorMessage.value = cause?.message || '培训经营配置创建失败。'
    uni.showToast({ title: errorMessage.value, icon: 'none' })
    return false
  } finally {
    uni.hideLoading()
    actionKey.value = ''
  }
}

async function createProduct() {
  if (!canConfigureTraining.value || actionKey.value) return
  errorMessage.value = ''
  try {
    const code = productCode.value.trim().toUpperCase()
    const name = productName.value.trim()
    const reason = requiredReason(productReason.value)
    if (!code || code.length > 40 || !name || name.length > 100) {
      throw new Error('产品编码和名称不能为空，编码最多 40 字符、名称最多 100 字符。')
    }
    const command = {
      code,
      name,
      audience: audienceOptions[productAudienceIndex.value].value,
      totalSessions: positiveInteger(productTotalSessions.value, '总课次', 1, 200),
      validityDays: positiveInteger(productValidityDays.value, '有效期天数', 1, 730),
      priceCents: yuanToCents(productPriceYuan.value, '课程售价', true),
      refundRule: {
        beforeStart: 'FULL_REFUND',
        afterStart: 'REFUND_UNUSED_SESSIONS',
      },
      reason,
    }
    const modal = await uni.showModal({
      title: '确认创建课程产品',
      content: `${name}\n${command.totalSessions} 课次 · 有效 ${command.validityDays} 天 · ${money(command.priceCents)}\n原因：${reason}`,
      confirmText: '确认创建',
    })
    if (!modal.confirm) return
    const succeeded = await runCreation('create-product', '课程产品已创建并写入审计记录。', () =>
      withPendingCreationKey('training.product.create', command, (creationIdempotencyKey) =>
        endpoints.createTrainingProduct({ ...command, creationIdempotencyKey }),
      ),
    )
    if (succeeded) {
      productCode.value = ''
      productName.value = ''
      productReason.value = ''
    }
  } catch (cause: any) {
    errorMessage.value = cause?.message || '课程产品表单校验失败。'
  }
}

async function createClass() {
  if (!canConfigureTraining.value || actionKey.value) return
  errorMessage.value = ''
  try {
    const product = selectedClassProduct.value
    const code = classCode.value.trim().toUpperCase()
    const name = className.value.trim()
    const reason = requiredReason(classReason.value)
    if (!product) throw new Error('请先创建并选择一个有效课程产品。')
    if (!code || code.length > 40 || !name || name.length > 100) {
      throw new Error('班级编码和名称不能为空，编码最多 40 字符、名称最多 100 字符。')
    }
    if (classEndTime.value <= classStartTime.value) {
      throw new Error('班级常规结束时间必须晚于开始时间。')
    }
    const command = {
      code,
      productId: product.id,
      name,
      coachId: classCoachId.value.trim() || undefined,
      assistantId: classAssistantId.value.trim() || undefined,
      schedule: {
        weekday: classWeekdayIndex.value + 1,
        startsAt: classStartTime.value,
        endsAt: classEndTime.value,
      },
      capacity: positiveInteger(classCapacity.value, '班级容量', 1, 100),
      coachCostCents: yuanToCents(classCoachCostYuan.value, '教练单课成本'),
      assistantCostCents: yuanToCents(classAssistantCostYuan.value, '助教单课成本'),
      materialCostCents: yuanToCents(classMaterialCostYuan.value, '单课物料成本'),
      reason,
    }
    const modal = await uni.showModal({
      title: '确认创建培训班级',
      content: `${name}\n${product.name} · ${weekdayOptions[classWeekdayIndex.value]} ${classStartTime.value}-${classEndTime.value}\n容量 ${command.capacity} 人 · 原因：${reason}`,
      confirmText: '确认创建',
    })
    if (!modal.confirm) return
    const succeeded = await runCreation('create-class', '培训班级已创建，可继续为其安排课次。', () =>
      withPendingCreationKey('training.class.create', command, (creationIdempotencyKey) =>
        endpoints.createTrainingClass({ ...command, creationIdempotencyKey }),
      ),
    )
    if (succeeded) {
      classCode.value = ''
      className.value = ''
      classReason.value = ''
    }
  } catch (cause: any) {
    errorMessage.value = cause?.message || '培训班级表单校验失败。'
  }
}

async function changeSessionDate(event: any) {
  sessionDate.value = event.detail.value
  selectedCourtIds.value = []
  await loadCourtAvailability()
}

function changeSessionCourts(event: any) {
  selectedCourtIds.value = Array.isArray(event.detail.value) ? event.detail.value : []
}

function isCourtBlocked(courtId: string) {
  return blockedCourtIds.value.has(courtId)
}

async function createSession() {
  if (!canCreateSession.value || actionKey.value) return
  errorMessage.value = ''
  try {
    const trainingClass = selectedSessionClass.value
    const startsAt = sessionStartsAt.value
    const endsAt = sessionEndsAt.value
    const startsTime = new Date(startsAt).getTime()
    const endsTime = new Date(endsAt).getTime()
    const reason = requiredReason(sessionReason.value)
    const note = sessionNote.value.trim()
    const courtIds = [...new Set(selectedCourtIds.value)].sort()
    if (!trainingClass) throw new Error('当前角色没有可排课的有效班级。')
    if (!Number.isFinite(startsTime) || !Number.isFinite(endsTime) || endsTime <= startsTime) {
      throw new Error('课次结束时间必须晚于开始时间。')
    }
    if (startsTime <= Date.now()) throw new Error('课次开始时间必须晚于当前时间。')
    if (!courtIds.length) throw new Error('请至少选择一个可用场地。')
    const blocked = courtIds.filter((courtId) => isCourtBlocked(courtId))
    if (blocked.length) throw new Error('所选场地在该时段已预约或封场，请重新选择。')
    if (note.length > 300) throw new Error('课次备注不能超过 300 个字符。')
    const command = {
      classId: trainingClass.id,
      startsAt,
      endsAt,
      courtIds,
      note: note || undefined,
      reason,
    }
    const courtNames = courtIds.map((id) =>
      sessionCourts.value.find((court) => court.id === id)?.name || id,
    ).join('、')
    const modal = await uni.showModal({
      title: '确认创建培训课次',
      content: `${trainingClass.name}\n${sessionDate.value} ${sessionStartTime.value}-${sessionEndTime.value}\n场地：${courtNames}\n原因：${reason}`,
      confirmText: '确认排课',
    })
    if (!modal.confirm) return
    const succeeded = await runCreation('create-session', '培训课次与场地占用已原子创建。', () =>
      withPendingCreationKey('training.session.create', command, (creationIdempotencyKey) =>
        endpoints.createTrainingSession({ ...command, creationIdempotencyKey }),
      ),
    )
    if (succeeded) {
      selectedCourtIds.value = []
      sessionNote.value = ''
      sessionReason.value = ''
    }
  } catch (cause: any) {
    errorMessage.value = cause?.message || '培训课次表单校验失败。'
  }
}

function recognitionTimeline(lesson: any, enrollment: any) {
  return [...(attendanceFor(lesson, enrollment)?.revenueRecognitions || [])]
    .sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence))
}

function activeRecognition(lesson: any, enrollment: any) {
  return [...recognitionTimeline(lesson, enrollment)]
    .reverse()
    .find((item: any) => item.type === 'CONSUME' && !item.reversedBy)
}

function activeCorrection(recognitionId: string) {
  return corrections.value.find((item) =>
    item.recognitionId === recognitionId && ['REQUESTED', 'APPROVED'].includes(item.status),
  )
}

function isOwnCorrection(correction: any) {
  return correction.requestedById === session.user?.id
}

function correctionStudentName(correction: any) {
  return correction.attendance?.enrollment?.student?.displayName
    || correction.attendance?.enrollment?.buyer?.displayName
    || '成人学员'
}

async function requestCorrection(lesson: any, enrollment: any) {
  if (!canRequestCorrection.value) return
  const recognition = activeRecognition(lesson, enrollment)
  if (!recognition) {
    uni.showToast({ title: '没有可冲正的有效消课流水', icon: 'none' }); return
  }
  if (activeCorrection(recognition.id)) {
    uni.showToast({ title: '该流水已有待处理或已批准冲正', icon: 'none' }); return
  }
  const modal = await uni.showModal({
    title: '申请消课冲正', content: '', editable: true,
    placeholderText: '填写误消原因和核对依据', confirmText: '提交复核',
  })
  const reason = modal.content?.trim() || ''
  if (!modal.confirm || reason.length < 2) return
  const command = { recognitionId: recognition.id, reason }
  try {
    await withPendingCreationKey(`training.consume-correction.${recognition.id}`, command, (idempotencyKey) =>
      endpoints.requestTrainingConsumeCorrection({ ...command, idempotencyKey }),
    )
    actionMessage.value = '冲正申请已提交；原消课仍有效，须由另一名管理员批准后才生成负向流水。'
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '冲正申请失败', icon: 'none' }) }
}

async function decideCorrection(correction: any, action: 'approve' | 'reject') {
  if (!isChecker.value) return
  if (isOwnCorrection(correction)) {
    uni.showToast({ title: '申请人与复核人不能是同一账号', icon: 'none' }); return
  }
  const modal = await uni.showModal({
    title: action === 'approve' ? '批准消课冲正' : '驳回消课冲正', content: '', editable: true,
    placeholderText: action === 'approve' ? '填写核对凭证和批准依据' : '填写驳回原因',
    confirmText: action === 'approve' ? '生成负向流水' : '确认驳回',
  })
  const reason = modal.content?.trim() || ''
  if (!modal.confirm || reason.length < 2) return
  const command = { correctionId: correction.id, action, reason }
  try {
    await withPendingCreationKey(`training.consume-correction.${correction.id}.${action}`, command, (idempotencyKey) =>
      action === 'approve'
        ? endpoints.approveTrainingConsumeCorrection(correction.id, { reason, idempotencyKey })
        : endpoints.rejectTrainingConsumeCorrection(correction.id, { reason, idempotencyKey }),
    )
    actionMessage.value = action === 'approve'
      ? '冲正已入账：出勤保留为已到场，收入、课时与成长积分已按负向流水回滚。'
      : '冲正申请已驳回，原消课流水和余额均未变化。'
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '冲正复核失败', icon: 'none' }) }
}

function studentsFor(lesson: any) {
  return activeStudents.value.filter((item) => item.classId === lesson.classId)
}

function attendanceFor(lesson: any, enrollment: any) {
  return (enrollment.attendances || []).find((item: any) =>
    item.sessionId === lesson.id || item.session?.id === lesson.id,
  )
}

function attendanceStatus(lesson: any, enrollment: any) {
  return attendanceFor(lesson, enrollment)?.status || 'PENDING'
}

function attendanceLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: '待点名',
    ATTENDED: '已到场',
    ABSENT: '缺席',
    MAKEUP_REQUIRED: '请假待补课',
    MADE_UP: '已安排补课',
    CANCELLED: '已取消',
  }
  return labels[status] || status
}

function hasPendingProposal(lesson: any, enrollment: any) {
  const attendance = attendanceFor(lesson, enrollment)
  return attendance?.status === 'ATTENDED' && Boolean(attendance.operatorId) && !attendance.consumedAt
}

function isConsumableLesson(lesson: any) {
  return !['COMPLETED', 'CANCELLED'].includes(lesson.status)
}

function hasUnresolvedAttendance(lesson: any) {
  return studentsFor(lesson).some((enrollment: any) => {
    const attendance = attendanceFor(lesson, enrollment)
    if (!attendance) return true
    if (['PENDING', 'LEAVE', 'MAKEUP_REQUIRED'].includes(attendance.status)) return true
    return attendance.status === 'ATTENDED' && Number(attendance.consumedSessions || 0) === 0
  })
}

async function mark(lesson: any, enrollment: any, status: 'ATTENDED' | 'ABSENT' | 'LEAVE' | 'CANCELLED') {
  let reason: string | undefined
  if (status === 'LEAVE' || status === 'CANCELLED') {
    const modal = await uni.showModal({
      title: status === 'LEAVE' ? '登记请假' : '取消本次课次',
      editable: true,
      content: '',
      placeholderText: '请填写原因',
    })
    if (!modal.confirm || !modal.content?.trim()) {
      uni.showToast({ title: '请填写原因', icon: 'none' })
      return
    }
    reason = modal.content.trim()
  }
  try {
    await endpoints.markTrainingAttendance(lesson.id, {
      enrollmentId: enrollment.id,
      status,
      reason,
      feedback: status === 'ATTENDED' ? '已到场，待提交消课建议' : undefined,
    })
    uni.showToast({ title: status === 'ATTENDED' ? '已登记到场' : '出勤状态已更新', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '消课失败', icon: 'none' }) }
}

async function propose(lesson: any, enrollment: any) {
  if (!isConsumableLesson(lesson)) {
    uni.showToast({ title: '已结束或已取消的课次不能继续消课', icon: 'none' })
    return
  }
  const modal = await uni.showModal({
    title: `提交${enrollment.student?.displayName || enrollment.buyer?.displayName || '学员'}消课建议`,
    editable: true,
    content: '',
    placeholderText: '训练反馈（可选）',
  })
  if (!modal.confirm) return
  try {
    await endpoints.consumeTraining(lesson.id, {
      enrollmentId: enrollment.id,
      feedback: modal.content?.trim() || '已到场，完成本次训练',
      attendanceStatus: 'PRESENT',
    })
    actionMessage.value = '消课建议已提交，待培训主管确认后才会确认收入和扣减课包。'
    uni.showToast({ title: '已提交待确认', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '提交失败', icon: 'none' }) }
}

async function confirm(lesson: any, enrollment: any) {
  if (!isConsumableLesson(lesson)) {
    uni.showToast({ title: '已结束或已取消的课次不能继续消课', icon: 'none' })
    return
  }
  const attendance = attendanceFor(lesson, enrollment)
  if (!attendance?.operatorId) {
    uni.showToast({ title: '须先由教练提交消课建议', icon: 'none' })
    return
  }
  if (attendance.operatorId === session.user?.id) {
    uni.showToast({ title: '建议提交人与确认人不能是同一账号', icon: 'none' })
    return
  }
  const modal = await uni.showModal({
    title: '确认消课入账',
    content: '确认后将扣减 1 次课包、确认本节培训收入并记入 20% 场馆合同流水。',
  })
  if (!modal.confirm) return
  try {
    const result: any = await endpoints.confirmTrainingConsume(lesson.id, {
      enrollmentId: enrollment.id,
      reason: '已核对点名与教练反馈',
    })
    actionMessage.value = `消课已入账：确认收入 ¥${((result?.effectiveRevenueCents || result?.recognizedRevenueCents || 0) / 100).toFixed(2)}，场馆分成 20%，场地费为 ¥0`
    uni.showToast({ title: '已确认入账', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '确认失败', icon: 'none' }) }
}

async function complete(lesson: any) {
  if (!isConsumableLesson(lesson)) return
  if (hasUnresolvedAttendance(lesson)) {
    uni.showToast({ title: '请先完成全部点名和消课确认', icon: 'none' })
    return
  }
  const modal = await uni.showModal({ title: '结束课程', content: '确认本节课程已结束？结束后不可继续消课。' })
  if (!modal.confirm) return
  try { await endpoints.completeTrainingSession(lesson.id); uni.showToast({ title: '课程已结束', icon: 'success' }); await load() }
  catch (cause: any) { uni.showToast({ title: cause.message || '结束失败', icon: 'none' }) }
}

onShow(load)
</script>

<template>
  <OperationsFrame title="培训运营" eyebrow="TRAINING OPERATIONS" :role="roleLabel" description="以课表为主线，按点名、消课建议、主管确认和课后反馈完成培训账本闭环。">
    <view v-if="!mayViewTraining" class="card access-denied">
      <text class="panel-title">无培训经营页权限</text>
      <text class="muted">该页面仅供教练、前台、财务与管理员按职责查看或操作。</text>
    </view>

    <template v-else>
    <view v-if="errorMessage" class="card error-panel">
      <view><text class="panel-title">操作未完成</text><text class="muted">{{ errorMessage }}</text></view>
      <button class="secondary inline" :disabled="loading || Boolean(actionKey)" @tap="load">重试</button>
    </view>
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>
    <view v-if="actionMessage" class="notice card">{{ actionMessage }}</view>

    <view class="section-title">课程产品与班级 <text class="section-note">{{ activeProducts.length }} 个产品 · {{ activeClasses.length }} 个有效班</text></view>
    <scroll-view v-if="activeProducts.length" scroll-x class="product-scroll">
      <view class="product-row">
        <view v-for="product in activeProducts" :key="product.id" class="card product-card">
          <view class="row"><text class="product-name">{{ product.name }}</text><StatusBadge :value="product.enabled === false ? 'DISABLED' : 'ACTIVE'" /></view>
          <text class="muted">{{ product.audience === 'YOUTH' ? '青少年' : '成人' }} · {{ product.totalSessions }} 课次 · 有效 {{ product.validityDays }} 天</text>
          <text class="product-price">{{ money(product.priceCents) }}</text>
          <view v-if="product.classes?.length" class="class-summary">
            <view v-for="trainingClass in product.classes" :key="trainingClass.id" class="class-summary-row">
              <view><text class="class-name">{{ trainingClass.name }}</text><text class="muted">容量 {{ trainingClass.capacity }} 人 · {{ trainingClass.coachId || '待分配教练' }}</text></view>
              <StatusBadge :value="trainingClass.active === false ? 'DISABLED' : 'ACTIVE'" />
            </view>
          </view>
          <text v-else class="muted class-empty">尚未创建班级</text>
        </view>
      </view>
    </scroll-view>
    <view v-else-if="!loading" class="empty card">暂无有效课程产品</view>

    <template v-if="canConfigureTraining">
      <view class="section-title">创建课程产品 <text class="section-note">仅管理员</text></view>
      <view class="card creation-form">
        <view class="form-grid">
          <view><text class="field-label">产品编码</text><input v-model="productCode" class="form-input" maxlength="40" placeholder="例如 ADULT-ADV-01" /></view>
          <view><text class="field-label">产品名称</text><input v-model="productName" class="form-input" maxlength="100" placeholder="例如 成人进阶课包" /></view>
        </view>
        <view class="form-grid">
          <picker :range="audienceOptions" range-key="label" :value="productAudienceIndex" @change="productAudienceIndex = Number(($event.detail as any).value)"><view><text class="field-label">适用人群</text><view class="picker-value">{{ audienceOptions[productAudienceIndex].label }} ›</view></view></picker>
          <view><text class="field-label">总课次</text><input v-model="productTotalSessions" class="form-input" type="number" /></view>
        </view>
        <view class="form-grid">
          <view><text class="field-label">有效期（天）</text><input v-model="productValidityDays" class="form-input" type="number" /></view>
          <view><text class="field-label">售价（元）</text><input v-model="productPriceYuan" class="form-input" type="digit" /></view>
        </view>
        <view><text class="field-label">创建原因（必填）</text><textarea v-model="productReason" class="reason-input" maxlength="300" placeholder="说明定价、课次与适用人群依据" /></view>
        <text class="guardrail">退费规则固定为开课前全退、开课后按未消耗课次退款。提交会生成持久幂等键，网络失败后原命令重试不会重复创建。</text>
        <button class="primary full-button" :loading="actionKey === 'create-product'" :disabled="loading || Boolean(actionKey)" @tap="createProduct">创建课程产品</button>
      </view>

      <view class="section-title">创建培训班级 <text class="section-note">仅管理员</text></view>
      <view class="card creation-form">
        <picker :range="activeProducts" range-key="name" :value="classProductIndex" @change="classProductIndex = Number(($event.detail as any).value)"><view><text class="field-label">所属产品</text><view class="picker-value">{{ selectedClassProduct?.name || '请先创建产品' }} ›</view></view></picker>
        <view class="form-grid">
          <view><text class="field-label">班级编码</text><input v-model="classCode" class="form-input" maxlength="40" placeholder="例如 CLASS-WED-01" /></view>
          <view><text class="field-label">班级名称</text><input v-model="className" class="form-input" maxlength="100" placeholder="例如 周三晚进阶班" /></view>
        </view>
        <view class="form-grid three-columns">
          <picker :range="weekdayOptions" :value="classWeekdayIndex" @change="classWeekdayIndex = Number(($event.detail as any).value)"><view><text class="field-label">常规星期</text><view class="picker-value">{{ weekdayOptions[classWeekdayIndex] }} ›</view></view></picker>
          <picker mode="time" :value="classStartTime" @change="classStartTime = ($event.detail as any).value"><view><text class="field-label">开始</text><view class="picker-value">{{ classStartTime }} ›</view></view></picker>
          <picker mode="time" :value="classEndTime" @change="classEndTime = ($event.detail as any).value"><view><text class="field-label">结束</text><view class="picker-value">{{ classEndTime }} ›</view></view></picker>
        </view>
        <view class="form-grid">
          <view><text class="field-label">容量（人）</text><input v-model="classCapacity" class="form-input" type="number" /></view>
          <view><text class="field-label">主教练用户 ID（选填）</text><input v-model="classCoachId" class="form-input" placeholder="例如 user-coach" /></view>
        </view>
        <view><text class="field-label">助教用户 ID（选填）</text><input v-model="classAssistantId" class="form-input" placeholder="未安排可留空" /></view>
        <view class="form-grid three-columns">
          <view><text class="field-label">教练成本/课（元）</text><input v-model="classCoachCostYuan" class="form-input" type="digit" /></view>
          <view><text class="field-label">助教成本/课（元）</text><input v-model="classAssistantCostYuan" class="form-input" type="digit" /></view>
          <view><text class="field-label">物料成本/课（元）</text><input v-model="classMaterialCostYuan" class="form-input" type="digit" /></view>
        </view>
        <view><text class="field-label">创建原因（必填）</text><textarea v-model="classReason" class="reason-input" maxlength="300" placeholder="说明开班、人员与成本依据" /></view>
        <button class="primary full-button" :loading="actionKey === 'create-class'" :disabled="loading || Boolean(actionKey) || !selectedClassProduct" @tap="createClass">创建培训班级</button>
      </view>
    </template>

    <template v-if="canCreateSession">
      <view class="section-title">创建培训课次 <text class="section-note">教练仅可排本人班级</text></view>
      <view class="card creation-form">
        <picker :range="sessionClasses" range-key="name" :value="sessionClassIndex" @change="sessionClassIndex = Number(($event.detail as any).value)"><view><text class="field-label">培训班级</text><view class="picker-value">{{ selectedSessionClass?.name || '暂无可排课班级' }} ›</view></view></picker>
        <view class="form-grid three-columns">
          <picker mode="date" :value="sessionDate" :start="shanghaiDate()" @change="changeSessionDate"><view><text class="field-label">课次日期</text><view class="picker-value">{{ sessionDate }} ›</view></view></picker>
          <picker mode="time" :value="sessionStartTime" @change="sessionStartTime = ($event.detail as any).value"><view><text class="field-label">开始</text><view class="picker-value">{{ sessionStartTime }} ›</view></view></picker>
          <picker mode="time" :value="sessionEndTime" @change="sessionEndTime = ($event.detail as any).value"><view><text class="field-label">结束</text><view class="picker-value">{{ sessionEndTime }} ›</view></view></picker>
        </view>
        <view>
          <text class="field-label">场地（至少选择一个）</text>
          <checkbox-group class="court-grid" @change="changeSessionCourts">
            <label v-for="court in sessionCourts" :key="court.id" class="court-choice" :class="{ blocked: isCourtBlocked(court.id) }">
              <checkbox :value="court.id" :checked="selectedCourtIds.includes(court.id)" :disabled="isCourtBlocked(court.id)" color="#17653d" />
              <text>{{ court.name }}</text><text class="court-usage">{{ isCourtBlocked(court.id) ? '冲突' : court.usage === 'TRAINING' ? '培训场' : '可用' }}</text>
            </label>
          </checkbox-group>
          <text v-if="!sessionCourts.length" class="muted">场地状态加载中或当天无可用场地。</text>
        </view>
        <view><text class="field-label">课次备注（选填）</text><input v-model="sessionNote" class="form-input" maxlength="300" placeholder="教学重点、器材或分组说明" /></view>
        <view><text class="field-label">创建原因（必填）</text><textarea v-model="sessionReason" class="reason-input" maxlength="300" placeholder="说明本次排课依据" /></view>
        <text class="guardrail">创建前同时校验未来时间、班级归属、封场和所有已确认场地预约；成功后课次与场地占用一并落账。</text>
        <button class="primary full-button" :loading="actionKey === 'create-session'" :disabled="loading || Boolean(actionKey) || !selectedSessionClass" @tap="createSession">创建培训课次</button>
      </view>
    </template>

    <view class="section-title">今日课表 <text class="section-note">{{ loading ? '同步中' : `${activeLessons.length} 节` }}</text></view>
    <view v-for="lesson in lessons" :key="lesson.id" class="card lesson-card">
      <view class="row"><view><text class="lesson-title">{{ lesson.class?.name || '未命名课程' }}</text><text class="muted">{{ shortDate(lesson.startsAt) }} · 占场 {{ lesson.occupiedCourtHours || 0 }} 小时</text></view><StatusBadge :value="lesson.status" /></view>
      <view v-if="studentsFor(lesson).length" class="student-list">
        <view v-for="student in studentsFor(lesson)" :key="student.id" class="student-row">
          <view class="student-main">
            <text class="student-name">{{ student.student?.displayName || student.buyer?.displayName || '成人学员' }}</text>
            <text class="muted">{{ student.usedSessions ?? student.consumedSessions ?? 0 }}/{{ student.totalSessions || 0 }} 次 · {{ student.enrollmentNo }}</text>
            <text class="attendance-state" :class="`state-${attendanceStatus(lesson, student).toLowerCase()}`">{{ attendanceLabel(attendanceStatus(lesson, student)) }}</text>
            <view v-if="recognitionTimeline(lesson, student).length" class="ledger-line">
              <text v-for="entry in recognitionTimeline(lesson, student)" :key="entry.id" :class="entry.type === 'REVERSAL' ? 'ledger-negative' : 'ledger-positive'">序{{ entry.sequence }} {{ entry.type === 'REVERSAL' ? '冲正' : '消课' }} {{ money(entry.effectiveRevenueCents) }}</text>
            </view>
          </view>
          <view class="student-actions">
            <template v-if="isConsumableLesson(lesson) && canMarkAttendance && attendanceStatus(lesson, student) === 'PENDING'">
              <button class="secondary inline" @tap="mark(lesson, student, 'ATTENDED')">到场</button>
              <button class="ghost inline" @tap="mark(lesson, student, 'ABSENT')">缺席</button>
              <button class="ghost inline" @tap="mark(lesson, student, 'LEAVE')">请假</button>
            </template>
            <button v-if="isConsumableLesson(lesson) && canProposeConsume && attendanceStatus(lesson, student) === 'ATTENDED' && !hasPendingProposal(lesson, student) && !(attendanceFor(lesson, student)?.consumedSessions)" class="secondary inline" @tap="propose(lesson, student)">提交消课建议</button>
            <button v-if="isConsumableLesson(lesson) && isChecker && hasPendingProposal(lesson, student)" class="primary inline" :disabled="attendanceFor(lesson, student)?.operatorId === session.user?.id" @tap="confirm(lesson, student)">确认入账</button>
            <text v-if="isConsumableLesson(lesson) && isChecker && hasPendingProposal(lesson, student) && attendanceFor(lesson, student)?.operatorId === session.user?.id" class="pending-text">本人提交，须由另一管理员确认</text>
            <text v-if="isConsumableLesson(lesson) && hasPendingProposal(lesson, student) && !isChecker" class="pending-text">待主管确认</text>
            <text v-if="attendanceStatus(lesson, student) === 'MAKEUP_REQUIRED'" class="pending-text">请安排补课</text>
            <button v-if="canRequestCorrection && activeRecognition(lesson, student) && !activeCorrection(activeRecognition(lesson, student).id)" class="danger inline" @tap="requestCorrection(lesson, student)">申请冲正</button>
            <text v-if="activeRecognition(lesson, student) && activeCorrection(activeRecognition(lesson, student).id)?.status === 'REQUESTED'" class="pending-text">冲正待复核</text>
          </view>
        </view>
      </view>
      <view v-else class="empty-line">本节没有可消课学员</view>
      <button v-if="canCreateSession && isConsumableLesson(lesson)" class="primary finish" :disabled="hasUnresolvedAttendance(lesson)" @tap="complete(lesson)">{{ hasUnresolvedAttendance(lesson) ? '先完成点名和消课' : '结束本节课程' }}</button>
    </view>
    <view v-if="!loading && !lessons.length" class="empty card">今天没有排课</view>
    <view class="section-title">消课冲正流水 <text class="section-note">{{ corrections.length }} 条</text></view>
    <view v-for="correction in corrections" :key="correction.id" class="card correction-card">
      <view class="row"><view><text class="student-name">{{ correctionStudentName(correction) }}</text><text class="muted">{{ correction.attendance?.session?.class?.name || '培训课次' }} · 申请人 {{ correction.requestedBy?.displayName || correction.requestedById }}</text></view><StatusBadge :value="correction.status" /></view>
      <text class="correction-reason">原因：{{ correction.reason }}</text>
      <view class="evidence-grid">
        <text>原消课：序{{ correction.recognition?.sequence || '-' }} · {{ money(correction.recognition?.effectiveRevenueCents) }}</text>
        <text>负向冲正：{{ correction.reversalRecognition ? `序${correction.reversalRecognition.sequence} · ${money(correction.reversalRecognition.effectiveRevenueCents)}` : '尚未生成' }}</text>
        <text>出勤：{{ attendanceLabel(correction.attendance?.status || 'PENDING') }} · 当前消课 {{ correction.attendance?.consumedSessions || 0 }} 次</text>
        <text>当前确认收入：{{ money(correction.attendance?.confirmedRevenueCents) }} · 成长积分计提 {{ correction.attendance?.growthPointsAwarded || 0 }}</text>
      </view>
      <view v-if="isChecker && correction.status === 'REQUESTED'" class="correction-actions">
        <button class="primary inline" :disabled="isOwnCorrection(correction)" @tap="decideCorrection(correction, 'approve')">批准冲正</button>
        <button class="danger inline" :disabled="isOwnCorrection(correction)" @tap="decideCorrection(correction, 'reject')">驳回</button>
        <text v-if="isOwnCorrection(correction)" class="pending-text">本人发起，需另一管理员复核</text>
      </view>
    </view>
    <view v-if="!loading && !corrections.length" class="empty card">暂无消课冲正申请</view>
    <view class="section-title">教练工作边界</view>
    <view class="card boundary"><text class="muted">教练可处理学员出勤、消课与训练反馈；退款审批、库存调整和结算发布由对应岗位处理。</text></view>
    </template>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }.notice { margin-top:20rpx; color:#17653d; background:#e8f4eb; line-height:1.6; }.lesson-card,.correction-card { margin-top:22rpx; padding:24rpx; }.lesson-title,.student-name { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; }.section-note { color:#758079; font-size:22rpx; font-weight:400; }.student-list { margin-top:20rpx; border-top:1rpx solid #edf0ed; }.student-row { display:flex; align-items:center; justify-content:space-between; gap:12rpx; padding:18rpx 0; border-bottom:1rpx solid #edf0ed; }.student-main { min-width:0; flex:1; }.student-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8rpx; }.attendance-state { display:block; margin-top:6rpx; color:#17653d; font-size:21rpx; }.state-absent,.state-cancelled { color:#a24c35; }.state-makeup_required { color:#9a6b1c; }.pending-text { color:#9a6b1c; font-size:20rpx; white-space:nowrap; }.inline { min-width:92rpx; min-height:54rpx; margin:0; padding:0 10rpx; line-height:54rpx; font-size:20rpx; }.ghost { color:#69756e; background:#eef2ef; }.ledger-line { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:8rpx; font-size:19rpx; }.ledger-positive { color:#17653d; }.ledger-negative { color:#a24c35; }.correction-reason { display:block; margin-top:16rpx; color:#4d5a52; font-size:23rpx; }.evidence-grid { display:grid; gap:8rpx; margin-top:14rpx; padding:16rpx; border-radius:14rpx; color:#526158; background:#f5f7f5; font-size:21rpx; }.correction-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10rpx; margin-top:16rpx; }.empty-line,.empty { color:#758079; text-align:center; }.empty-line { padding:22rpx 0 4rpx; }.finish { width:100%; margin-top:20rpx; }.boundary { margin-top:0; line-height:1.7; }
.access-denied { margin-top:22rpx; text-align:center; }.panel-title { display:block; margin-bottom:8rpx; font-size:28rpx; font-weight:800; }.error-panel { display:flex; align-items:center; justify-content:space-between; gap:16rpx; margin-top:22rpx; color:#8a3636; background:#fff4f2; }.error-panel .muted { display:block; line-height:1.5; }.product-scroll { white-space:nowrap; }.product-row { display:flex; gap:14rpx; }.product-card { box-sizing:border-box; width:540rpx; flex:0 0 540rpx; white-space:normal; }.product-name,.class-name { display:block; font-weight:800; }.product-name { max-width:350rpx; overflow:hidden; font-size:28rpx; text-overflow:ellipsis; white-space:nowrap; }.product-price { display:block; margin-top:14rpx; color:#17653d; font-size:30rpx; font-weight:800; }.class-summary { display:grid; gap:10rpx; margin-top:16rpx; padding-top:12rpx; border-top:1rpx solid #edf0ed; }.class-summary-row { display:flex; align-items:center; justify-content:space-between; gap:12rpx; }.class-summary-row .muted,.class-empty { display:block; margin-top:5rpx; font-size:20rpx; }.creation-form { display:grid; gap:16rpx; }.form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14rpx; }.form-grid.three-columns { grid-template-columns:repeat(3,minmax(0,1fr)); }.field-label { display:block; margin-bottom:8rpx; color:#68756d; font-size:21rpx; }.form-input,.picker-value,.reason-input { box-sizing:border-box; width:100%; color:#244c37; background:#f2f6f3; border:1rpx solid #dfe9e2; border-radius:16rpx; font-size:23rpx; }.form-input,.picker-value { min-height:68rpx; padding:16rpx 18rpx; }.reason-input { min-height:112rpx; padding:16rpx 18rpx; }.guardrail { color:#7b6940; font-size:22rpx; line-height:1.6; }.full-button { width:100%; margin:0; }.court-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10rpx; }.court-choice { display:flex; align-items:center; gap:6rpx; padding:14rpx 10rpx; background:#eef5f0; border:1rpx solid #dce8df; border-radius:14rpx; font-size:21rpx; }.court-choice.blocked { color:#9a7770; background:#f5f1f0; }.court-usage { margin-left:auto; color:#758079; font-size:18rpx; }
</style>
