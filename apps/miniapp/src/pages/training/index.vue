<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { useSessionStore } from '../../stores/session'
import { requestMemberLogin, openMemberPage } from '../../utils/member-navigation'
import SectionEmpty from '../../components/SectionEmpty.vue'
import ReasonForm from '../../components/ReasonForm.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { money, shortDate } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import {
  parseYuanToCents,
  pendingTrainingRefundCents,
  trainingRefundLimitCents,
} from '../../utils/training-refund'

const session = useSessionStore()
const audience = ref('ALL')
const expandedEnrollments = ref<Record<string, boolean>>({})
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
const selectedProductId = ref('')
const selectedClassId = ref('')
const selectedStudentId = ref('')
const purchaseError = ref('')
const eligibleStudents = computed(() => students.value.filter(item => item.guardianConsentStatus))
const refundItemId = ref('')
const refundMaximum = ref(0)
const refundOrder = ref<any>(null)
const refundError = ref('')
const customRefund = ref(false)
const refundAmount = ref('')
function preparePurchase(product: any) {
  if (purchasingId.value) return
  selectedProductId.value = product.id
  selectedClassId.value = product.classes?.length === 1 ? product.classes[0].id : ''
  selectedStudentId.value = eligibleStudents.value.length === 1 ? eligibleStudents.value[0].id : ''
  purchaseError.value = ''
  if (product.audience === 'YOUTH' && !eligibleStudents.value.length) {
    audience.value = 'YOUTH'
    showStudentForm.value = true
    uni.pageScrollTo({ scrollTop: 0, duration: 200 })
  }
}
const showStudentForm = ref(false)
const defaultBirthMonth = `${new Date().getFullYear() - 10}-01`
const studentForm = ref({ displayName: '', birthMonth: defaultBirthMonth, guardianConsentStatus: false })
const maxBirthMonth = computed(() => new Date().toISOString().slice(0, 7))
function openStudentForm() { showStudentForm.value = true; uni.pageScrollTo({ scrollTop: 0, duration: 200 }) }

onLoad((query) => {
  const requested = query?.tab
  if (requested === 'products' || requested === 'mine' || requested === 'trials') {
    tab.value = requested
  }
})
const visibleProducts = computed(() => products.value.filter((item) => audience.value === 'ALL' || item.audience === audience.value))
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
  if (!session.isAuthenticated) return requestMemberLogin('/pages/training/index?tab=' + tab.value)
  loading.value = true
  error.value = ''
  try {
    if (!(await session.hydrate())) { throw new Error('报名人信息暂未同步，请重试') }
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

async function createStudent() {
  if (savingStudent.value) return
  const displayName = studentForm.value.displayName.trim()
  if (!displayName) return uni.showToast({ title: '请填写学员姓名', icon: 'none' })
  if (!studentForm.value.guardianConsentStatus) {
    return uni.showToast({ title: '需由监护人确认授权', icon: 'none' })
  }
  savingStudent.value = true
  try {
    const created: any = await endpoints.createTrainingStudent({
      displayName,
      birthMonth: `${studentForm.value.birthMonth}-01T00:00:00.000Z`,
      guardianConsentStatus: true,
    })
    studentForm.value = { displayName: '', birthMonth: defaultBirthMonth, guardianConsentStatus: false }
    showStudentForm.value = false
    await load()
    selectedStudentId.value = created?.id || eligibleStudents.value[eligibleStudents.value.length - 1]?.id || ''
    uni.showToast({ title: '学员档案已建立', icon: 'success' })
  } catch (cause: any) {
    uni.showToast({ title: cause.message, icon: 'none' })
  } finally {
    savingStudent.value = false
  }
}

async function purchase(product: any) {
  if (purchasingId.value) return
  purchaseError.value = ''
  if (product.classes?.length && !product.classes.some((item: any) => item.id === selectedClassId.value)) {
    purchaseError.value = '请先选择上课班级'; return
  }
  if (product.audience === 'YOUTH' && !eligibleStudents.value.some(item => item.id === selectedStudentId.value)) {
    purchaseError.value = '请选择已由监护人授权的学员；没有档案时可在上方新建'; return
  }
  purchasingId.value = product.id
  try {
    const command = {
      productId: product.id,
      classId: selectedClassId.value || undefined,
      studentId: product.audience === 'YOUTH' ? selectedStudentId.value : undefined,
      sourceChannel: 'MINI_PROGRAM',
    }
    const order: any = await withPendingCreationKey('training.purchase', command, creationIdempotencyKey =>
      endpoints.purchaseTraining({ ...command, creationIdempotencyKey }),
    )
    await openMemberPage('/pages/order/index?id=' + encodeURIComponent(order.id))
  } catch (cause: any) { purchaseError.value = cause.message || '报名失败，请重试' }
  finally { purchasingId.value = '' }
}

async function prepareRefund(item: any) {
  if (refundingId.value) return
  refundItemId.value = item.id
  refundingId.value = item.id
  refundError.value = ''
  refundOrder.value = null
  customRefund.value = false
  refundMaximum.value = 0
  try {
    const order: any = await endpoints.order(item.orderId)
    if (pendingTrainingRefundCents(order) > 0 || order.status === 'REFUND_PENDING') {
      refundError.value = '已有退费申请处理中，请在订单查看进度，处理结束后再申请。'; return
    }
    refundMaximum.value = trainingRefundLimitCents(item, order)
    if (refundMaximum.value <= 0) {
      refundError.value = '当前没有可退的未使用课时余额；如消课记录有误，请联系教练或前台。'; return
    }
    refundAmount.value = (refundMaximum.value / 100).toFixed(2)
    refundOrder.value = order
  } catch (cause: any) { refundError.value = cause.message || '可退金额未同步，请重试' }
  finally { refundingId.value = '' }
}
async function requestTrainingRefund(item: any, reason: string) {
  if (!refundOrder.value || refundingId.value || refundItemId.value !== item.id) return
  const amountCents = customRefund.value ? parseYuanToCents(refundAmount.value) : refundMaximum.value
  if (amountCents === null || amountCents <= 0 || amountCents > refundMaximum.value) {
    refundError.value = '请输入 0.01 至 ' + (refundMaximum.value / 100).toFixed(2) + ' 元'; return
  }
  refundingId.value = item.id
  refundError.value = ''
  try {
    const command = { orderId: item.orderId, amountCents, reason }
    await withPendingCreationKey('training.refund', command, idempotencyKey =>
      endpoints.refundOrder(item.orderId, { amountCents, reason, idempotencyKey }),
    )
    refundItemId.value = ''
    uni.showToast({ title: '退费申请已提交', icon: 'success' })
    await load()
    await openMemberPage('/pages/order/index?id=' + encodeURIComponent(item.orderId))
  } catch (cause: any) { refundError.value = cause.message || '退费申请失败，请重试' }
  finally { refundingId.value = '' }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view class="course-intro"><text class="banner-title">{{ tab === 'products' ? '找到适合你的课程' : tab === 'mine' ? '我的课程' : '我的试听记录' }}</text><text>{{ tab === 'products' ? '先选课程，再选择班级与报名学员。' : '查看上课记录、剩余课时与老师反馈。' }}</text></view>
    <view v-if="error" class="card load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view class="tabs"><button :class="{ active: tab === 'products' }" @tap="tab='products'">找课程</button><button :class="{ active: tab === 'mine' }" @tap="tab='mine'">我的课程</button><button v-if="trials.length || tab === 'trials'" :class="{ active: tab === 'trials' }" @tap="tab='trials'">试听记录</button></view>
    <template v-if="tab === 'products'">
      <view class="audience-tabs"><button v-for="option in [{ value: 'ALL', label: '全部' }, { value: 'ADULT', label: '成人课程' }, { value: 'YOUTH', label: '青少年课程' }]" :key="option.value" :class="{ selected: audience === option.value }" @tap="audience = option.value">{{ option.label }}</button></view>
      <view v-if="audience === 'YOUTH' || showStudentForm" class="card student-card">
        <view class="row"><view><text class="student-title">我的青少年学员</text><text class="student-tip">监护人主账号负责授权与报名</text></view><button class="mini" @tap="showStudentForm = !showStudentForm">{{ showStudentForm ? '收起' : '添加学员' }}</button></view>
        <view v-if="students.length" class="student-list">
          <view v-for="student in students" :key="student.id" class="student-row"><text>{{ student.displayName }}</text><text :class="student.guardianConsentStatus ? 'consent-ok' : 'consent-warn'">{{ student.guardianConsentStatus ? '已授权' : '待授权' }}</text></view>
        </view>
        <view v-else-if="!showStudentForm" class="student-tip empty-student">尚未建立学员档案，青少年课包暂不能报名。</view>
        <view v-if="showStudentForm" class="student-form">
          <text class="student-tip">学员姓名或常用称呼</text><input v-model="studentForm.displayName" aria-label="学员姓名" maxlength="40" placeholder="请填写学员姓名或常用称呼" />
          <picker mode="date" fields="month" :value="studentForm.birthMonth" :end="maxBirthMonth" @change="setBirthMonth"><view class="picker-row"><text>出生月份</text><text>{{ studentForm.birthMonth }}</text></view></picker>
          <view class="consent-row"><text>我确认是该学员监护人，并授权用于课程报名、出勤与紧急联系</text><switch color="#17653d" :checked="studentForm.guardianConsentStatus" @change="setConsent" /></view>
          <button class="primary save-student" :loading="savingStudent" :disabled="savingStudent" @tap="createStudent">保存并完成授权</button>
        </view>
      </view>
      <view v-for="product in visibleProducts" :key="product.id" class="card product">
        <view class="row"><text class="pill">{{ product.audience === 'YOUTH' ? '青少年' : '成人' }}</text><text class="muted">有效期 {{ product.validityDays }} 天</text></view>
        <text class="title">{{ product.name }}</text>
        <view class="details"><text>{{ product.totalSessions }}次课</text><text>{{ product.classes?.length || 0 }}个可选班级</text></view>
        <view class="row footer"><text class="money">{{ money(product.priceCents) }}</text><button class="secondary buy" :loading="purchasingId === product.id" :disabled="Boolean(purchasingId)" @tap="preparePurchase(product)">选择报名</button></view>
        <view v-if="selectedProductId === product.id" class="enroll-form">
          <text class="student-title">确认报名信息</text>
          <text class="muted">所选课程：{{ product.name }} · {{ money(product.priceCents) }}</text>
          <view v-if="product.classes?.length">
            <text class="student-tip">上课班级</text>
            <picker :range="product.classes" range-key="name" :value="Math.max(0, product.classes.findIndex((item: any) => item.id === selectedClassId))" :disabled="Boolean(purchasingId)" @change="selectedClassId = product.classes[Number($event.detail.value)]?.id || ''"><view class="picker-row">{{ product.classes.find((item: any) => item.id === selectedClassId)?.name || '请选择班级' }} · 点击选择</view></picker>
          </view>
          <view v-if="product.audience === 'YOUTH'">
            <text class="student-tip">报名学员</text>
            <picker v-if="eligibleStudents.length" :range="eligibleStudents" range-key="displayName" :disabled="Boolean(purchasingId)" @change="selectedStudentId = eligibleStudents[Number($event.detail.value)]?.id || ''"><view class="picker-row">{{ eligibleStudents.find(item => item.id === selectedStudentId)?.displayName || '请选择已授权学员' }} · 点击选择</view></picker>
            <button class="secondary" @tap="openStudentForm">新建学员档案</button>
          </view>
          <text v-else class="muted">报名人：{{ session.user?.displayName }}（本人）</text>
          <text v-if="purchaseError" class="form-error" role="alert">{{ purchaseError }}</text>
          <button class="primary" :loading="purchasingId === product.id" :disabled="Boolean(purchasingId)" @tap="purchase(product)">确认报名，下一步付款</button>
          <button class="secondary" :disabled="Boolean(purchasingId)" @tap="selectedProductId = ''">暂不报名</button>
        </view>
      </view>
      <SectionEmpty v-if="!visibleProducts.length && !loading && !error" title="暂无在售课程" />
    </template>
    <template v-else-if="tab === 'mine'">
      <view v-for="item in enrollments" :key="item.id" class="card enrollment">
        <view class="row"><text class="title compact">{{ item.product?.name }}</text><StatusBadge :value="item.status" /></view>
        <text v-if="item.student" class="student-tip">学员：{{ item.student.displayName }}</text>
        <text class="remaining">剩余 {{ Math.max(0, Number(item.remainingSessions ?? (item.totalSessions - consumed(item)))) }} 次课</text>
        <view class="progress"><view :style="{ width: `${Math.min(100, item.totalSessions ? consumed(item) / item.totalSessions * 100 : 0)}%` }"></view></view>
        <view class="row"><text class="muted">已消 {{ consumed(item) }}/{{ item.totalSessions }} 次</text><text class="muted">有效至 {{ shortDate(item.expiresAt) }}</text></view>
        <button class="details-toggle" @tap="expandedEnrollments[item.id] = !expandedEnrollments[item.id]">{{ expandedEnrollments[item.id] ? '收起费用明细' : '查看费用明细' }}</button>
        <view v-if="expandedEnrollments[item.id]" class="training-ledger">
          <view><text class="ledger-label">实付学费</text><text class="ledger-value">{{ money(receivedPrepaidCents(item)) }}</text></view>
          <view><text class="ledger-label">已使用课时费用</text><text class="ledger-value confirmed">{{ money(confirmedRevenueCents(item)) }}</text></view>
          <view><text class="ledger-label">未使用课时金额</text><text class="ledger-value">{{ money(unusedPrepaidCents(item)) }}</text></view>
          <view><text class="ledger-label">累计退费</text><text class="ledger-value refunded">{{ money(refundedCents(item)) }}</text></view>
        </view>
        <text v-if="expandedEnrollments[item.id]" class="ledger-note">费用按上课与退费记录更新；如发现上课记录有误，请联系教练核实。</text>
        <view v-if="item.regulatoryWarnings?.length" class="regulatory-warning"><text v-for="warning in item.regulatoryWarnings" :key="warning">{{ warning }}</text></view>
        <view v-if="canRequestRefund(item)" class="refund-actions">
          <text class="refund-limit">未使用课时金额 {{ money(unusedPrepaidCents(item)) }}，可退金额以申请时核对为准</text>
          <button class="secondary refund-button" :loading="refundingId === item.id" :disabled="Boolean(refundingId)" @tap="prepareRefund(item)">申请退费</button>
        </view>
        <view v-if="refundItemId === item.id && !refundOrder" class="enroll-form"><text v-if="refundingId" class="muted">正在核对可退金额…</text><text v-if="refundError" class="form-error" role="alert">{{ refundError }}</text><button class="secondary" @tap="openMemberPage('/pages/order/index?id=' + encodeURIComponent(item.orderId))">查看相关订单</button></view>
        <ReasonForm v-if="refundItemId === item.id && refundOrder" :key="item.id" title="申请未使用课时退费" :description="'最多可退 ' + money(refundMaximum) + '；原支付方式：' + paymentComposition(refundOrder) + '。提交后等待审核，按原支付规则退回，已使用课时不在退费范围。'" :busy="Boolean(refundingId)" :error="refundError" confirm-text="确认申请退费" @cancel="refundItemId = ''" @submit="requestTrainingRefund(item, $event)">
          <view class="refund-amount">
            <button class="secondary" :aria-pressed="!customRefund" :disabled="Boolean(refundingId)" @tap="customRefund = false; refundError = ''">全部可退余额 {{ money(refundMaximum) }}</button>
            <button class="secondary" :aria-pressed="customRefund" :disabled="Boolean(refundingId)" @tap="customRefund = true; refundError = ''">指定退费金额</button>
            <view v-if="customRefund"><text class="student-tip">申请金额（元）</text><input v-model="refundAmount" class="input" aria-label="申请退费金额" type="digit" :disabled="Boolean(refundingId)" /></view>
          </view>
        </ReasonForm>
        <view v-if="item.attendances?.[0]" class="feedback">最近：{{ item.attendances[0].feedback || '已完成签到消课' }}</view>
      </view>
      <SectionEmpty v-if="!enrollments.length && !loading && !error" title="还没有课程" description="找到合适的课程并报名后，可以在这里查看课时。" />
      <button v-if="!enrollments.length && !loading" class="secondary" @tap="tab = 'products'">去找课程</button>
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
.enroll-form { display:grid; gap:20rpx; margin-top:22rpx; padding:24rpx; border:1rpx solid var(--color-border); border-radius:20rpx; background:var(--color-surface-subtle); }.enroll-form button,.refund-amount button { width:100%; margin:0; padding:18rpx 12rpx; font-size:26rpx; }.form-error { color:var(--color-danger); line-height:1.6; }.refund-amount { display:grid; gap:16rpx; }.refund-amount button[aria-pressed="true"] { outline:2rpx solid var(--color-primary); }

.audience-tabs { display:flex; gap:12rpx; margin-bottom:22rpx; }
.audience-tabs button { flex:1; margin:0; font-size:24rpx; color:var(--color-muted); background:transparent; }
.audience-tabs .selected { background:var(--color-primary-soft); color:var(--color-primary); }
.remaining { display:block; margin-top:22rpx; color:var(--color-primary); font-size:36rpx; font-weight:800; }
.details-toggle { width:100%; margin:16rpx 0 0; color:var(--color-muted); background:transparent; font-size:24rpx; }
.course-intro { padding: 28rpx; margin-bottom: 22rpx; color: rgba(255,255,255,.78); background: linear-gradient(135deg,#173e2a,#236d47); border-radius: 28rpx; font-size: 23rpx; line-height: 1.7; }
.banner-title { display: block; margin-bottom: 10rpx; color: #fff; font-size: 31rpx; font-weight: 800; }
.tabs { display: flex; gap: 12rpx; padding: 8rpx; margin-bottom: 22rpx; background: #e7ece8; border-radius: 22rpx; }.tabs button { flex: 1; width:100%; padding:16rpx 6rpx; margin:0; background:transparent; color:var(--color-muted); font-size:26rpx; text-align:center; }.tabs .active { background: #fff; border-radius: 17rpx; font-weight: 700; }
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
