<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import StatusBadge from '../../../../components/StatusBadge.vue'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { money, shortDate } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

const session = useSessionStore()
const lessons = ref<any[]>([])
const enrollments = ref<any[]>([])
const corrections = ref<any[]>([])
const loading = ref(false)
const actionMessage = ref('')
const roleLabel = computed(() => session.roles.includes('COACH') ? '教练' : '前台协作')
const isChecker = computed(() => session.roles.includes('ADMIN') || session.roles.includes('SUPER_ADMIN'))
const canMarkAttendance = computed(() =>
  session.roles.some((role) => ['COACH', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canRequestCorrection = computed(() =>
  session.roles.some((role) => ['COACH', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const requestedCorrections = computed(() => corrections.value.filter((item) => item.status === 'REQUESTED'))

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
  loading.value = true
  const result = await Promise.allSettled([
    endpoints.trainingSessions(), endpoints.adminEnrollments(), endpoints.trainingConsumeCorrections(),
  ])
  if (result[0].status === 'fulfilled') lessons.value = result[0].value || []
  if (result[1].status === 'fulfilled') enrollments.value = result[1].value || []
  if (result[2].status === 'fulfilled') corrections.value = result[2].value || []
  loading.value = false
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

async function consume(lesson: any, enrollment: any) {
  if (isChecker.value) return confirm(lesson, enrollment)
  return propose(lesson, enrollment)
}

async function complete(lesson: any) {
  const modal = await uni.showModal({ title: '结束课程', content: '确认本节课程已结束？结束后不可继续消课。' })
  if (!modal.confirm) return
  try { await endpoints.completeTrainingSession(lesson.id); uni.showToast({ title: '课程已结束', icon: 'success' }); await load() }
  catch (cause: any) { uni.showToast({ title: cause.message || '结束失败', icon: 'none' }) }
}

onShow(load)
</script>

<template>
  <OperationsFrame title="培训运营" eyebrow="TRAINING OPERATIONS" :role="roleLabel" description="以课表为主线，按点名、消课建议、主管确认和课后反馈完成培训账本闭环。">
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>
    <view v-if="actionMessage" class="notice card">{{ actionMessage }}</view>
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
            <template v-if="canMarkAttendance && attendanceStatus(lesson, student) === 'PENDING'">
              <button class="secondary inline" @tap="mark(lesson, student, 'ATTENDED')">到场</button>
              <button class="ghost inline" @tap="mark(lesson, student, 'ABSENT')">缺席</button>
              <button class="ghost inline" @tap="mark(lesson, student, 'LEAVE')">请假</button>
            </template>
            <button v-if="attendanceStatus(lesson, student) === 'ATTENDED' && !hasPendingProposal(lesson, student) && !(attendanceFor(lesson, student)?.consumedSessions)" class="secondary inline" @tap="consume(lesson, student)">{{ isChecker ? '确认消课' : '提交消课建议' }}</button>
            <button v-if="isChecker && hasPendingProposal(lesson, student)" class="primary inline" @tap="confirm(lesson, student)">确认入账</button>
            <text v-if="hasPendingProposal(lesson, student) && !isChecker" class="pending-text">待主管确认</text>
            <text v-if="attendanceStatus(lesson, student) === 'MAKEUP_REQUIRED'" class="pending-text">请安排补课</text>
            <button v-if="canRequestCorrection && activeRecognition(lesson, student) && !activeCorrection(activeRecognition(lesson, student).id)" class="danger inline" @tap="requestCorrection(lesson, student)">申请冲正</button>
            <text v-if="activeRecognition(lesson, student) && activeCorrection(activeRecognition(lesson, student).id)?.status === 'REQUESTED'" class="pending-text">冲正待复核</text>
          </view>
        </view>
      </view>
      <view v-else class="empty-line">本节没有可消课学员</view>
      <button v-if="lesson.status !== 'COMPLETED'" class="primary finish" @tap="complete(lesson)">结束本节课程</button>
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
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }.notice { margin-top:20rpx; color:#17653d; background:#e8f4eb; line-height:1.6; }.lesson-card,.correction-card { margin-top:22rpx; padding:24rpx; }.lesson-title,.student-name { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; }.section-note { color:#758079; font-size:22rpx; font-weight:400; }.student-list { margin-top:20rpx; border-top:1rpx solid #edf0ed; }.student-row { display:flex; align-items:center; justify-content:space-between; gap:12rpx; padding:18rpx 0; border-bottom:1rpx solid #edf0ed; }.student-main { min-width:0; flex:1; }.student-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8rpx; }.attendance-state { display:block; margin-top:6rpx; color:#17653d; font-size:21rpx; }.state-absent,.state-cancelled { color:#a24c35; }.state-makeup_required { color:#9a6b1c; }.pending-text { color:#9a6b1c; font-size:20rpx; white-space:nowrap; }.inline { min-width:92rpx; min-height:54rpx; margin:0; padding:0 10rpx; line-height:54rpx; font-size:20rpx; }.ghost { color:#69756e; background:#eef2ef; }.ledger-line { display:flex; flex-wrap:wrap; gap:8rpx; margin-top:8rpx; font-size:19rpx; }.ledger-positive { color:#17653d; }.ledger-negative { color:#a24c35; }.correction-reason { display:block; margin-top:16rpx; color:#4d5a52; font-size:23rpx; }.evidence-grid { display:grid; gap:8rpx; margin-top:14rpx; padding:16rpx; border-radius:14rpx; color:#526158; background:#f5f7f5; font-size:21rpx; }.correction-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10rpx; margin-top:16rpx; }.empty-line,.empty { color:#758079; text-align:center; }.empty-line { padding:22rpx 0 4rpx; }.finish { width:100%; margin-top:20rpx; }.boundary { margin-top:0; line-height:1.7; }
</style>
