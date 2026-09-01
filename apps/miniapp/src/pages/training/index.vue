<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { idempotencyKey, money, shortDate } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import {
  parseYuanToCents,
  pendingTrainingRefundCents,
  trainingRefundLimitCents,
} from '../../utils/training-refund'

const products = ref<any[]>([])
const enrollments = ref<any[]>([])
const students = ref<any[]>([])
const trials = ref<any[]>([])
const tab = ref<'products' | 'mine' | 'trials'>('products')
const loading = ref(false)
const error = ref('')
const savingStudent = ref(false)
const purchasingId = ref('')
const refundingId = ref('')
const showStudentForm = ref(false)
const defaultBirthMonth = `${new Date().getFullYear() - 10}-01`
const studentForm = ref({ displayName: '', birthMonth: defaultBirthMonth, guardianConsentStatus: false })
const maxBirthMonth = computed(() => new Date().toISOString().slice(0, 7))

onLoad((query) => {
  const requested = query?.tab
  if (requested === 'products' || requested === 'mine' || requested === 'trials') {
    tab.value = requested
  }
})
const hasYouthProducts = computed(() => products.value.some((item) => item.audience === 'YOUTH'))
const consumed = (item: any) => Number(item.consumedSessions ?? item.usedSessions ?? 0)
const refundedCents = (item: any) => Number(item.refundedCents || 0)
const unusedPrepaidCents = (item: any) => Number(item.prepaidBalanceCents || 0)
const confirmedRevenueCents = (item: any) => {
  if (item.confirmedRevenueCents !== undefined && item.confirmedRevenueCents !== null) {
    return Number(item.confirmedRevenueCents)
  }
  const contractAmount = Number(item.totalAmountCents ?? item.product?.priceCents ?? 0)
  return Math.max(0, contractAmount - unusedPrepaidCents(item) - refundedCents(item))
}
const receivedPrepaidCents = (item: any) => {
  if (item.status === 'PENDING_PAYMENT') return 0
  return confirmedRevenueCents(item) + unusedPrepaidCents(item) + refundedCents(item)
}
const canRequestRefund = (item: any) =>
  Boolean(item.orderId) &&
  unusedPrepaidCents(item) > 0 &&
  ['ACTIVE', 'PARTIALLY_REFUNDED'].includes(String(item.status))
const paymentLabels: Record<string, string> = {
  WECHAT: '微信支付',
  OFFLINE_CASH: '线下现金',
  CASH_PRINCIPAL: '现金本金账户',
  GIFT_BALANCE: '赠送余额',
  BADMINTON_COIN: '羽球币',
  COUPON: '优惠券',
}
const paymentComposition = (order: any) => {
  const payments = (Array.isArray(order.payments) ? order.payments : [])
    .filter((payment: any) => ['SUCCEEDED', 'REFUNDED'].includes(String(payment.status)))
    .map((payment: any) => `${paymentLabels[payment.channel] || payment.channel} ${money(payment.amountCents)}`)
  if (payments.length) return payments.join(' + ')
  const channel = order.paymentChannel
  return channel ? paymentLabels[channel] || channel : '以原支付渠道为准'
}
const setBirthMonth = (event: any) => { studentForm.value.birthMonth = String(event.detail.value) }
const setConsent = (event: any) => { studentForm.value.guardianConsentStatus = Boolean(event.detail.value) }
async function load() {
  loading.value = true
  error.value = ''
  try {
    [products.value, students.value, enrollments.value, trials.value] = await Promise.all([
      endpoints.trainingProducts(),
      endpoints.trainingStudents(),
      endpoints.trainingEnrollments(),
      endpoints.myTrainingTrials(),
    ])
  }
  catch (cause: any) { error.value = cause?.message || '培训数据加载失败，请稍后重试' }
  finally { loading.value = false }
}

function choose<T>(items: T[], label: (item: T) => string): Promise<T | undefined> {
  if (items.length <= 1) return Promise.resolve(items[0])
  return new Promise((resolve) => {
    uni.showActionSheet({
      itemList: items.map(label),
      success: ({ tapIndex }) => resolve(items[tapIndex]),
      fail: () => resolve(undefined),
    })
  })
}

async function createStudent() {
  const displayName = studentForm.value.displayName.trim()
  if (!displayName) return uni.showToast({ title: '请填写学员姓名', icon: 'none' })
  if (!studentForm.value.guardianConsentStatus) {
    return uni.showToast({ title: '需由监护人确认授权', icon: 'none' })
  }
  savingStudent.value = true
  try {
    await endpoints.createTrainingStudent({
      displayName,
      birthMonth: `${studentForm.value.birthMonth}-01T00:00:00.000Z`,
      guardianConsentStatus: true,
    })
    studentForm.value = { displayName: '', birthMonth: defaultBirthMonth, guardianConsentStatus: false }
    showStudentForm.value = false
    await load()
    uni.showToast({ title: '学员档案已建立', icon: 'success' })
  } catch (cause: any) {
    uni.showToast({ title: cause.message, icon: 'none' })
  } finally {
    savingStudent.value = false
  }
}

async function purchase(product: any) {
  let student: any
  if (product.audience === 'YOUTH') {
    const eligibleStudents = students.value.filter((item) => item.guardianConsentStatus)
    if (!eligibleStudents.length) {
      showStudentForm.value = true
      return uni.showModal({
        title: '先建立学员档案',
        content: '青少年报名必须绑定监护人主账号并完成授权。请在本页填写学员信息。',
        showCancel: false,
      })
    }
    student = await choose(eligibleStudents, (item) => `${item.displayName}（已授权）`)
    if (!student) return
  }
  const selectedClass = await choose(product.classes || [], (item: any) => item.name)
  if (product.classes?.length && !selectedClass) return
  purchasingId.value = product.id
  try {
    const command = {
      productId: product.id,
      classId: selectedClass?.id,
      studentId: student?.id,
      sourceChannel: 'MINI_PROGRAM',
    }
    const order: any = await withPendingCreationKey('training.purchase', command, (creationIdempotencyKey) =>
      endpoints.purchaseTraining({ ...command, creationIdempotencyKey }),
    )
    uni.showModal({
      title: '课包订单已创建',
      content: `${order.orderNo} 待支付。付款记培训预收，实际消课后才确认收入。`,
      confirmText: '去订单支付',
      success: ({ confirm }) => confirm && uni.navigateTo({ url: '/pages/order/index' }),
    })
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
  finally { purchasingId.value = '' }
}

async function requestTrainingRefund(item: any) {
  if (!item.orderId || refundingId.value) return
  refundingId.value = item.id
  try {
    const order: any = await endpoints.order(item.orderId)
    const pendingCents = pendingTrainingRefundCents(order)
    if (pendingCents > 0 || order.status === 'REFUND_PENDING') {
      return uni.showModal({
        title: '退费申请处理中',
        content: `已有 ${money(pendingCents)} 待审批，完成或驳回后才能再次申请。`,
        showCancel: false,
      })
    }
    const maximumCents = trainingRefundLimitCents(item, order)
    if (maximumCents <= 0) {
      return uni.showModal({
        title: '当前无可退余额',
        content: '已消课收入不能直接退款；如消课记录有误，须先由教练发起、管理员复核冲正。',
        showCancel: false,
      })
    }
    const scope = await uni.showModal({
      title: '核对可退范围',
      content: `最大可退 ${money(maximumCents)}，仅来自未消课预收。原支付构成：${paymentComposition(order)}。退款审批后按原规则退回，不会冲掉已确认消课收入。`,
      confirmText: '填写金额',
    })
    if (!scope.confirm) return
    const amountResult = await uni.showModal({
      title: `退费金额（最多 ${money(maximumCents)}）`,
      content: (maximumCents / 100).toFixed(2),
      editable: true,
      placeholderText: '请输入金额，单位元，最多两位小数',
      confirmText: '下一步',
    })
    if (!amountResult.confirm) return
    const amountCents = parseYuanToCents(amountResult.content)
    if (amountCents === null || amountCents > maximumCents) {
      return uni.showToast({
        title: `请输入 0.01 至 ${(maximumCents / 100).toFixed(2)} 元`,
        icon: 'none',
      })
    }
    const reasonResult = await uni.showModal({
      title: `确认申请 ${money(amountCents)}`,
      content: '退还未消课预收余额',
      editable: true,
      placeholderText: '请填写退费原因（至少2个字）',
      confirmText: '提交申请',
    })
    if (!reasonResult.confirm) return
    const reason = String(reasonResult.content || '').trim()
    if (reason.length < 2) {
      return uni.showToast({ title: '退费原因至少需要2个字', icon: 'none' })
    }
    await endpoints.refundOrder(order.id, {
      amountCents,
      reason,
      idempotencyKey: idempotencyKey(`training-refund-${order.id}`),
    })
    uni.showToast({ title: '退费申请已提交', icon: 'success' })
    await load()
  } catch (cause: any) {
    uni.showToast({ title: cause.message || '退费申请失败', icon: 'none' })
  } finally {
    refundingId.value = ''
  }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view class="ledger-banner"><text class="banner-title">培训独立经营账</text><text>购买课包不立即确认收入；每次签到消课确认有效收入，其中20%计入场馆合同收入，不另收场地费。</text></view>
    <view v-if="error" class="card load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view class="tabs"><view :class="{ active: tab === 'products' }" @tap="tab='products'">课程课包</view><view :class="{ active: tab === 'mine' }" @tap="tab='mine'">我的课表</view><view :class="{ active: tab === 'trials' }" @tap="tab='trials'">试听结果</view></view>
    <template v-if="tab === 'products'">
      <view v-if="hasYouthProducts" class="card student-card">
        <view class="row"><view><text class="student-title">我的青少年学员</text><text class="student-tip">监护人主账号负责授权与报名</text></view><button class="mini" @tap="showStudentForm = !showStudentForm">{{ showStudentForm ? '收起' : '添加学员' }}</button></view>
        <view v-if="students.length" class="student-list">
          <view v-for="student in students" :key="student.id" class="student-row"><text>{{ student.displayName }}</text><text :class="student.guardianConsentStatus ? 'consent-ok' : 'consent-warn'">{{ student.guardianConsentStatus ? '已授权' : '待授权' }}</text></view>
        </view>
        <view v-else-if="!showStudentForm" class="student-tip empty-student">尚未建立学员档案，青少年课包暂不能报名。</view>
        <view v-if="showStudentForm" class="student-form">
          <input v-model="studentForm.displayName" maxlength="40" placeholder="学员姓名或常用称呼" />
          <picker mode="date" fields="month" :value="studentForm.birthMonth" :end="maxBirthMonth" @change="setBirthMonth"><view class="picker-row"><text>出生月份</text><text>{{ studentForm.birthMonth }}</text></view></picker>
          <view class="consent-row"><text>我确认是该学员监护人，并授权用于课程报名、出勤与紧急联系</text><switch color="#17653d" :checked="studentForm.guardianConsentStatus" @change="setConsent" /></view>
          <button class="primary save-student" :loading="savingStudent" :disabled="savingStudent" @tap="createStudent">保存并完成授权</button>
        </view>
      </view>
      <view v-for="product in products" :key="product.id" class="card product">
        <view class="row"><text class="pill">{{ product.audience === 'YOUTH' ? '青少年' : '成人' }}</text><text class="muted">有效期 {{ product.validityDays }} 天</text></view>
        <text class="title">{{ product.name }}</text>
        <view class="details"><text>{{ product.totalSessions }}次课</text><text>{{ product.classes?.length || 0 }}个可选班级</text></view>
        <view class="row footer"><text class="money">{{ money(product.priceCents) }}</text><button class="secondary buy" :loading="purchasingId === product.id" :disabled="Boolean(purchasingId)" @tap="purchase(product)">立即报名</button></view>
      </view>
      <SectionEmpty v-if="!products.length && !loading && !error" title="暂无在售课包" />
    </template>
    <template v-else-if="tab === 'mine'">
      <view v-for="item in enrollments" :key="item.id" class="card enrollment">
        <view class="row"><text class="title compact">{{ item.product?.name }}</text><StatusBadge :value="item.status" /></view>
        <text v-if="item.student" class="student-tip">学员：{{ item.student.displayName }}</text>
        <view class="progress"><view :style="{ width: `${Math.min(100, item.totalSessions ? consumed(item) / item.totalSessions * 100 : 0)}%` }"></view></view>
        <view class="row"><text class="muted">已消 {{ consumed(item) }}/{{ item.totalSessions }} 次</text><text class="muted">有效至 {{ shortDate(item.expiresAt) }}</text></view>
        <view class="training-ledger">
          <view><text class="ledger-label">培训预收款</text><text class="ledger-value">{{ money(receivedPrepaidCents(item)) }}</text></view>
          <view><text class="ledger-label">已消课收入</text><text class="ledger-value confirmed">{{ money(confirmedRevenueCents(item)) }}</text></view>
          <view><text class="ledger-label">未消课余额</text><text class="ledger-value">{{ money(unusedPrepaidCents(item)) }}</text></view>
          <view><text class="ledger-label">累计退费</text><text class="ledger-value refunded">{{ money(refundedCents(item)) }}</text></view>
        </view>
        <text class="ledger-note">四栏独立：购课先记预收；仅经确认的消课转为收入；退费只冲未消课余额，已消课须先走冲正。</text>
        <view v-if="item.regulatoryWarnings?.length" class="regulatory-warning"><text v-for="warning in item.regulatoryWarnings" :key="warning">{{ warning }}</text></view>
        <view v-if="canRequestRefund(item)" class="refund-actions">
          <text class="refund-limit">当前最多可申请 {{ money(unusedPrepaidCents(item)) }}，最终以订单待审批占用校验为准</text>
          <button class="secondary refund-button" :loading="refundingId === item.id" :disabled="Boolean(refundingId)" @tap="requestTrainingRefund(item)">申请未消课退费</button>
        </view>
        <view v-if="item.attendances?.[0]" class="feedback">最近：{{ item.attendances[0].feedback || '已完成签到消课' }}</view>
      </view>
      <SectionEmpty v-if="!enrollments.length && !loading && !error" title="还没有课程" />
    </template>
    <template v-else>
      <view v-for="trial in trials" :key="trial.id" class="card trial-result">
        <view class="row"><view><text class="title compact">{{ trial.student?.displayName || trial.member?.displayName || '我的试听' }}</text><text class="student-tip">{{ trial.product?.name }} · {{ shortDate(trial.scheduledStartsAt) }}</text></view><StatusBadge :value="trial.status" /></view>
        <text class="trial-coach">教练：{{ trial.coach?.displayName || '到店后由课程老师接待' }} · 试听编号 {{ trial.trialNo }}</text>
        <view v-if="trial.assessmentDimensions?.length" class="trial-scores">
          <view v-for="dimension in trial.assessmentDimensions" :key="dimension.key"><text>{{ dimension.label }}</text><text>{{ dimension.score }}/5</text><text v-if="dimension.note" class="dimension-note">{{ dimension.note }}</text></view>
        </view>
        <view v-if="trial.recommendation" class="trial-recommendation"><text class="recommendation-title">教练建议</text><text>{{ trial.recommendation }}</text><text v-if="trial.assessmentNote" class="dimension-note">{{ trial.assessmentNote }}</text></view>
        <text v-else class="student-tip">{{ trial.status === 'CHECKED_IN' ? '已签到，等待教练提交测评。' : trial.status === 'RESERVED' ? '预约成功，请按时到场。' : '当前暂无测评结果。' }}</text>
        <text v-if="trial.student" class="privacy-note">该结果仅对本学员监护人账号和授权经营人员可见。</text>
      </view>
      <SectionEmpty v-if="!trials.length && !loading && !error" title="还没有试听记录" />
    </template>
  </view>
</template>
<style scoped>
.ledger-banner { padding: 28rpx; margin-bottom: 22rpx; color: rgba(255,255,255,.78); background: linear-gradient(135deg,#173e2a,#236d47); border-radius: 28rpx; font-size: 23rpx; line-height: 1.7; }
.banner-title { display: block; margin-bottom: 10rpx; color: #fff; font-size: 31rpx; font-weight: 800; }
.tabs { display: flex; gap: 12rpx; padding: 8rpx; margin-bottom: 22rpx; background: #e7ece8; border-radius: 22rpx; }.tabs view { flex: 1; padding: 20rpx; text-align: center; }.tabs .active { background: #fff; border-radius: 17rpx; font-weight: 700; }
.title { display: block; margin: 24rpx 0 16rpx; font-size: 33rpx; font-weight: 800; }.title.compact { margin: 0; }
.details { display: flex; gap: 28rpx; color: #6e776f; font-size: 24rpx; }.footer { margin-top: 26rpx; }.buy { min-width: 180rpx; margin: 0; }
.progress { height: 12rpx; margin: 28rpx 0 12rpx; overflow: hidden; background: #edf0ed; border-radius: 99rpx; }.progress view { height: 100%; background: #1b7045; border-radius: inherit; }
.training-ledger { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12rpx; margin-top: 20rpx; }.training-ledger view { padding: 18rpx; background: #f4f7f4; border-radius: 16rpx; }.ledger-label { display: block; color: #728077; font-size: 21rpx; }.ledger-value { display: block; margin-top: 8rpx; color: #264e39; font-size: 27rpx; font-weight: 800; }.ledger-value.confirmed { color: #17653d; }.ledger-value.refunded { color: #9a4b3f; }.ledger-note { display: block; margin-top: 14rpx; color: #7a725c; font-size: 21rpx; line-height: 1.55; }
.refund-actions { display: flex; gap: 18rpx; align-items: center; margin-top: 18rpx; padding-top: 18rpx; border-top: 1rpx solid #edf0ed; }.refund-limit { flex: 1; color: #7a725c; font-size: 20rpx; line-height: 1.5; }.refund-button { flex: none; min-width: 218rpx; margin: 0; padding: 0 18rpx; font-size: 22rpx; }
.feedback { padding: 18rpx; margin-top: 20rpx; color: #5c685f; background: #f4f7f4; border-radius: 16rpx; font-size: 23rpx; }
.student-card { margin-bottom: 22rpx; }.student-title { display: block; font-size: 29rpx; font-weight: 800; }.student-tip { display: block; margin-top: 7rpx; color: #728077; font-size: 22rpx; }.mini { flex: none; min-width: 132rpx; margin: 0; padding: 0 18rpx; font-size: 23rpx; line-height: 58rpx; }
.student-list { margin-top: 20rpx; border-top: 1rpx solid #edf0ed; }.student-row { display: flex; justify-content: space-between; padding: 18rpx 0; border-bottom: 1rpx solid #edf0ed; font-size: 25rpx; }.consent-ok { color: #17653d; }.consent-warn { color: #a66417; }.empty-student { padding: 18rpx 0 2rpx; }
.student-form { padding-top: 20rpx; }.student-form input,.picker-row { box-sizing: border-box; width: 100%; min-height: 82rpx; padding: 21rpx 24rpx; margin-bottom: 16rpx; background: #f4f7f4; border-radius: 16rpx; font-size: 25rpx; }.picker-row { display: flex; justify-content: space-between; }.consent-row { display: flex; gap: 18rpx; align-items: center; color: #5c685f; font-size: 22rpx; line-height: 1.55; }.consent-row text { flex: 1; }.save-student { margin-top: 20rpx; }
.regulatory-warning { display:grid; gap:8rpx; margin-top:16rpx; padding:16rpx; color:#965220; background:#fff4e8; border-radius:14rpx; font-size:21rpx; }.trial-result { margin-bottom:20rpx; }.trial-coach,.privacy-note { display:block; margin-top:15rpx; color:#69766d; font-size:21rpx; }.trial-scores { display:grid; grid-template-columns:repeat(3,1fr); gap:10rpx; margin-top:18rpx; }.trial-scores view { display:grid; gap:6rpx; padding:16rpx; color:#355641; background:#eef5f0; border-radius:14rpx; font-size:21rpx; }.trial-scores view text:nth-child(2) { color:#17653d; font-size:27rpx; font-weight:800; }.dimension-note { color:#778078; font-size:19rpx; line-height:1.45; }.trial-recommendation { display:grid; gap:9rpx; margin-top:16rpx; padding:18rpx; color:#405b4a; background:#f4f7f4; border-radius:14rpx; font-size:23rpx; line-height:1.6; }.recommendation-title { font-weight:800; }
.load-error { display:flex; align-items:center; gap:18rpx; color:#9a3e36; background:#fff4f2; }.load-error text { flex:1; min-width:0; line-height:1.5; overflow-wrap:anywhere; }.retry { flex:0 0 auto; min-height:64rpx; margin:0; padding:0 22rpx; line-height:64rpx; font-size:23rpx; }
@media (max-width: 360px) {
  .load-error,.refund-actions,.student-card > .row { align-items: stretch; flex-wrap: wrap; }
  .load-error .retry,.refund-button { width: 100%; }
  .refund-limit { flex-basis: 100%; }
  .trial-scores { grid-template-columns: 1fr; }
}
</style>
