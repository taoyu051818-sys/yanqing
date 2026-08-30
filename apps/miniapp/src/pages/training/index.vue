<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { money, shortDate } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const products = ref<any[]>([])
const enrollments = ref<any[]>([])
const students = ref<any[]>([])
const tab = ref<'products' | 'mine'>('products')
const loading = ref(false)
const savingStudent = ref(false)
const purchasingId = ref('')
const showStudentForm = ref(false)
const defaultBirthMonth = `${new Date().getFullYear() - 10}-01`
const studentForm = ref({ displayName: '', birthMonth: defaultBirthMonth, guardianConsentStatus: false })
const maxBirthMonth = computed(() => new Date().toISOString().slice(0, 7))
const hasYouthProducts = computed(() => products.value.some((item) => item.audience === 'YOUTH'))
const consumed = (item: any) => Number(item.consumedSessions ?? item.usedSessions ?? 0)
const setBirthMonth = (event: any) => { studentForm.value.birthMonth = String(event.detail.value) }
const setConsent = (event: any) => { studentForm.value.guardianConsentStatus = Boolean(event.detail.value) }
async function load() {
  loading.value = true
  try {
    [products.value, students.value, enrollments.value] = await Promise.all([
      endpoints.trainingProducts(),
      endpoints.trainingStudents(),
      endpoints.trainingEnrollments(),
    ])
  }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
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
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view class="ledger-banner"><text class="banner-title">培训独立经营账</text><text>购买课包不立即确认收入；每次签到消课确认有效收入，其中20%计入场馆合同收入，不另收场地费。</text></view>
    <view class="tabs"><view :class="{ active: tab === 'products' }" @tap="tab='products'">课程课包</view><view :class="{ active: tab === 'mine' }" @tap="tab='mine'">我的课表</view></view>
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
      <SectionEmpty v-if="!products.length && !loading" title="暂无在售课包" />
    </template>
    <template v-else>
      <view v-for="item in enrollments" :key="item.id" class="card enrollment">
        <view class="row"><text class="title compact">{{ item.product?.name }}</text><StatusBadge :value="item.status" /></view>
        <text v-if="item.student" class="student-tip">学员：{{ item.student.displayName }}</text>
        <view class="progress"><view :style="{ width: `${Math.min(100, item.totalSessions ? consumed(item) / item.totalSessions * 100 : 0)}%` }"></view></view>
        <view class="row"><text class="muted">已消 {{ consumed(item) }}/{{ item.totalSessions }} 次</text><text class="muted">有效至 {{ shortDate(item.expiresAt) }}</text></view>
        <view v-if="item.attendances?.[0]" class="feedback">最近：{{ item.attendances[0].feedback || '已完成签到消课' }}</view>
      </view>
      <SectionEmpty v-if="!enrollments.length && !loading" title="还没有课程" />
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
.feedback { padding: 18rpx; margin-top: 20rpx; color: #5c685f; background: #f4f7f4; border-radius: 16rpx; font-size: 23rpx; }
.student-card { margin-bottom: 22rpx; }.student-title { display: block; font-size: 29rpx; font-weight: 800; }.student-tip { display: block; margin-top: 7rpx; color: #728077; font-size: 22rpx; }.mini { flex: none; min-width: 132rpx; margin: 0; padding: 0 18rpx; font-size: 23rpx; line-height: 58rpx; }
.student-list { margin-top: 20rpx; border-top: 1rpx solid #edf0ed; }.student-row { display: flex; justify-content: space-between; padding: 18rpx 0; border-bottom: 1rpx solid #edf0ed; font-size: 25rpx; }.consent-ok { color: #17653d; }.consent-warn { color: #a66417; }.empty-student { padding: 18rpx 0 2rpx; }
.student-form { padding-top: 20rpx; }.student-form input,.picker-row { box-sizing: border-box; width: 100%; min-height: 82rpx; padding: 21rpx 24rpx; margin-bottom: 16rpx; background: #f4f7f4; border-radius: 16rpx; font-size: 25rpx; }.picker-row { display: flex; justify-content: space-between; }.consent-row { display: flex; gap: 18rpx; align-items: center; color: #5c685f; font-size: 22rpx; line-height: 1.55; }.consent-row text { flex: 1; }.save-student { margin-top: 20rpx; }
</style>
