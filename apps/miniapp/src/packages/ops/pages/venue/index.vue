<script setup lang="ts">
import { useUnsavedForm } from "../../composables/use-unsaved-form";
import { computed, ref, watch } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";

import PriceManagement from "./PriceManagement.vue";
import OperationsTabs from "../../components/OperationsTabs.vue";
import OperationsFrame from '../../components/OperationsFrame.vue'
import OperationTask from '../../components/OperationTask.vue'
import { useOperationTask, reasonField } from '../../components/operation-task'
import { hasOperationsAccess } from "../../../../config/operations";
import {
  endpoints,
  type VenueClosure,
} from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import type { CourtAvailability } from "../../../../types/domain";
import { idempotencyKey, today as shanghaiDate, shortDate } from "../../../../utils/format";

const task = useOperationTask()
const session = useSessionStore()
const loading = ref(false);
const submitting = ref(false);
const loadError = ref("");
const actionError = ref("");
const calendar = ref<CourtAvailability | null>(null);
const closures = ref<VenueClosure[]>([]);
const selectedDate = ref(shanghaiDate(1));
const startTime = ref("09:00");
const endTime = ref("11:00");
const reason = ref("");
const courtIndex = ref(0);
const pendingCreationKey = ref("");
const managementView = ref('closures');
const venueTabs = [{ key:'closures', title:'封场维护' }, { key:'pricing', title:'价格设置' }];
const priceSourceId = ref('');
function openClosureForm() { uni.navigateTo({ url:`/packages/ops/pages/venue/index?view=create-closure&date=${selectedDate.value}` }); }
const { markSaved } = useUnsavedForm(() => [selectedDate.value, startTime.value, endTime.value, reason.value, courtIndex.value], () => managementView.value === 'create-closure');

const canManage = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);
const roleLabel = computed(() => {
  if (session.roles.includes("SUPER_ADMIN")) return "超级管理员";
  if (session.roles.includes("ADMIN")) return "管理员";
  return "前台只读";
});
const courts = computed(() => calendar.value?.courts || []);
const selectedCourt = computed(() => courts.value[courtIndex.value] || null);
const activeClosures = computed(() =>
  closures.value.filter((item) => item.status === "ACTIVE"),
);
const affectedCourtCount = computed(
  () => new Set(activeClosures.value.map((item) => item.courtId)).size,
);
function dayRange(date: string) {
  const fromDate = new Date(`${date}T00:00:00+08:00`);
  return {
    from: fromDate.toISOString(),
    to: new Date(fromDate.getTime() + 86_400_000).toISOString(),
  };
}

function localIso(date: string, time: string) {
  return `${date}T${time}:00+08:00`;
}

const displayTime = shortDate;

async function load() {
  await session.hydrate();
  if (!hasOperationsAccess(session.roles, "venue")) {
    loadError.value = "当前账号没有场馆维护日历查看权限。";
    return;
  }
  loading.value = true;
  loadError.value = "";
  try {
    const range = dayRange(selectedDate.value);
    const [availability, records] = await Promise.all([
      endpoints.availability(selectedDate.value),
      endpoints.venueClosures(range),
    ]);
    calendar.value = availability;
    closures.value = records;
    if (courtIndex.value >= availability.courts.length) courtIndex.value = 0;
  } catch (cause: any) {
    loadError.value = cause?.message || "封场日历加载失败，请稍后重试。";
  } finally {
    loading.value = false;
  }

}

function changeDate(event: any) {
  selectedDate.value = event.detail.value;
  pendingCreationKey.value = "";
  load();
}

function changeCourt(event: any) {
  courtIndex.value = Number(event.detail.value) || 0;
  pendingCreationKey.value = "";
}

async function createClosure() {
  if (!canManage.value || !selectedCourt.value || submitting.value) return;
  actionError.value = "";
  const cleanReason = reason.value.trim();
  const startsAt = localIso(selectedDate.value, startTime.value);
  const endsAt = localIso(selectedDate.value, endTime.value);
  if (cleanReason.length < 2) {
    actionError.value = "请填写至少 2 个字的封场原因。";
    return;
  }
  if (new Date(endsAt) <= new Date(startsAt)) {
    actionError.value = "结束时间必须晚于开始时间。";
    return;
  }
  const confirmed = await uni.showModal({
    title: "确认创建封场",
    content: `${selectedCourt.value.name} · ${selectedDate.value} ${startTime.value}-${endTime.value}\n${cleanReason}\n若范围内已有预约，系统会阻止操作且不会自动取消或退款。`,
    confirmText: "确认封场",
  });
  if (!confirmed.confirm) return;
  if (!pendingCreationKey.value) {
    pendingCreationKey.value = idempotencyKey("court-closure");
  }
  submitting.value = true;
  try {
    await endpoints.createVenueClosure({
      courtId: selectedCourt.value.id,
      startsAt,
      endsAt,
      reason: cleanReason,
      creationIdempotencyKey: pendingCreationKey.value,
    });
    pendingCreationKey.value = "";
    reason.value = "";
    uni.showToast({ title: "封场计划已生效", icon: "success" });
    markSaved();
    uni.navigateBack({ fail:() => uni.redirectTo({ url:'/packages/ops/pages/venue/index' }) });
  } catch (cause: any) {
    actionError.value =
      cause?.message || "封场计划创建失败，请核对预约冲突后重试。";
  } finally {
    submitting.value = false;
  }
}

function cancelClosure(item: VenueClosure) {
  if (!canManage.value || item.status !== 'ACTIVE' || submitting.value) return
  task.start({ title: '取消封场', description: (item.court?.name || '当前场地') + ' · ' + displayTime(item.startsAt) + ' 至 ' + displayTime(item.endsAt) + '。取消后恢复可订，不自动重建此前已处理预约。',
    confirmText: '确认恢复可售', fields: [reasonField('取消封场原因', ['场地维护已完成','原活动安排取消'])],
    submit: async ({ reason }) => { await endpoints.cancelVenueClosure(item.id, reason); await load(); return '封场已取消，符合售卖规则的时段恢复可订。' },
  })
}

onLoad((options) => {
  const view = String(options?.view || 'closures');
  managementView.value = ['closures', 'pricing', 'create-closure', 'create-price'].includes(view) ? view : 'closures';
  priceSourceId.value = String(options?.source || '');
  if (typeof options?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)) selectedDate.value = options.date;
  markSaved();
  uni.setNavigationBarTitle({ title:managementView.value === 'create-price' ? '设置价格' : managementView.value === 'create-closure' ? '新增封场' : '场地维护与价格' });
});
watch(managementView, view => { if (view === 'closures') void load(); });
onShow(async () => {
  await session.hydrate();
  if (managementView.value === 'closures' || managementView.value === 'create-closure') void load();
});
</script>

<template>
  <OperationsFrame
    access="venue"
    icon="venue"
    title="场馆维护日历"
    eyebrow="VENUE AVAILABILITY CONTROL"
    :role="roleLabel"
    description="先核对预约，再按真实起止时间封场；封场只改变可售资源，不会静默取消订单或触发退款。"
  >
    <OperationTask :task="task" />
    <OperationsTabs v-if="!managementView.startsWith('create-')" v-model="managementView" :items="venueTabs" label="场馆配置分类" />
    <view v-if="actionError" class="error-card card sticky-error" role="alert"><text class="error-copy">{{ actionError }}</text></view>
    <template v-if="managementView === 'closures' || managementView === 'create-closure'">
    <view class="section-title">查看日期</view>
    <view class="card date-card">
      <picker mode="date" :value="selectedDate" :start="shanghaiDate()" @change="changeDate">
        <view class="picker-row">
          <view>
            <text class="field-label">维护日历日期</text>
            <text class="field-value">{{ selectedDate }}</text>
          </view>
          <text class="picker-action">切换 ›</text>
        </view>
      </picker>
      <view class="summary-grid">
        <view><text class="summary-value">{{ activeClosures.length }}</text><text class="summary-label">生效封场</text></view>
        <view><text class="summary-value">{{ affectedCourtCount }}</text><text class="summary-label">影响场地</text></view>
        <view><text class="summary-value">{{ courts.length }}</text><text class="summary-label">可管理场地</text></view>
      </view>
    </view>

    <button v-if="canManage && managementView === 'closures'" class="primary" @tap="openClosureForm">新增封场计划</button>
    <template v-if="canManage && managementView === 'create-closure'">
      <view class="card form-card">
        <picker :range="courts" range-key="name" :value="courtIndex" @change="changeCourt">
          <view class="field-row"><text>场地</text><text class="field-choice">{{ selectedCourt?.name || "暂无场地" }} ›</text></view>
        </picker>
        <view class="time-grid">
          <picker mode="time" :value="startTime" @change="startTime = ($event.detail as any).value; pendingCreationKey = ''">
            <view class="time-field"><text>开始</text><text>{{ startTime }}</text></view>
          </picker>
          <picker mode="time" :value="endTime" @change="endTime = ($event.detail as any).value; pendingCreationKey = ''">
            <view class="time-field"><text>结束</text><text>{{ endTime }}</text></view>
          </picker>
        </view>
        <text class="field-label">封场原因（必填）</text><textarea v-model="reason" class="reason-input" maxlength="300" placeholder="填写维护、赛事包场或安全检查原因" @input="pendingCreationKey = ''" />
        <text class="guardrail">提交前会重新检查重叠封场和未取消预约；存在预约时返回数量与明细，由管理员另行处理。</text>
        <button class="primary" :loading="submitting" :disabled="submitting || !selectedCourt" @tap="createClosure">创建封场计划</button>
      </view>
    </template>
    <view v-if="!canManage" class="readonly card">
      <text class="readonly-title">前台只读视图</text>
      <text class="muted">你可以查看封场和原因，但创建、取消必须由管理员完成。</text>
    </view>

    <template v-if="managementView === 'closures'">
    <view class="section-title">当日封场记录</view>
    <view v-if="loading" class="card state-card"><text>正在同步维护日历…</text></view>
    <view v-else-if="loadError" class="card error-card">
      <text class="error-title">日历加载失败</text>
      <text class="error-copy">{{ loadError }}</text>
      <button class="secondary" @tap="load">重新加载</button>
    </view>
    <view v-else-if="!closures.length" class="card state-card">
      <text class="state-title">当日没有封场记录</text>
      <text class="muted">所有启用场地仍按预约和用途规则开放。</text>
    </view>
    <view v-else class="closure-list">
      <view v-for="item in closures" :key="item.id" class="card closure-card" :class="{ cancelled: item.status === 'CANCELLED' }">
        <view class="row">
          <view>
            <text class="closure-court">{{ item.court?.name || item.courtId }}</text>
            <text class="closure-time">{{ displayTime(item.startsAt) }} — {{ displayTime(item.endsAt) }}</text>
          </view>
          <text class="status-pill" :class="item.status.toLowerCase()">{{ item.status === "ACTIVE" ? "生效中" : "已取消" }}</text>
        </view>
        <text class="closure-reason">{{ item.reason }}</text>
        <text class="audit-line">创建：{{ item.createdBy?.displayName || item.createdById }} · {{ displayTime(item.createdAt) }}</text>
        <text v-if="item.status === 'CANCELLED'" class="audit-line">取消：{{ item.cancelledBy?.displayName || item.cancelledById }} · {{ item.cancelReason }}</text>
        <button v-if="canManage && item.status === 'ACTIVE'" class="danger compact" :disabled="submitting" @tap="cancelClosure(item)">取消封场</button>
      </view>
    </view>

    </template>
    </template>
    <PriceManagement v-if="managementView === 'pricing' || managementView === 'create-price'" :editing="managementView === 'create-price'" :source-id="priceSourceId" :can-manage="canManage" />
  </OperationsFrame>
</template>

<style scoped>
.date-card { margin-top: 0; }
.picker-row,.field-row { display:flex; align-items:center; justify-content:space-between; gap:20rpx; }
.field-label { display:block; color:#758079; font-size:23rpx; }
.field-value { display:block; margin-top:8rpx; font-size:34rpx; font-weight:800; }
.picker-action,.field-choice { color:#17653d; font-weight:700; }
.summary-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12rpx; margin-top:26rpx; padding-top:22rpx; border-top:1rpx solid #e8ece9; text-align:center; }
.summary-value,.summary-label { display:block; }.summary-value { color:#155a37; font-size:34rpx; font-weight:800; }.summary-label { margin-top:5rpx; color:#758079; font-size:21rpx; }
.form-card { display:grid; gap:20rpx; }.field-row { min-height:76rpx; padding:0 20rpx; background:#f5f7f4; border-radius:18rpx; }
.time-grid { display:grid; grid-template-columns:1fr 1fr; gap:14rpx; }.time-field { display:flex; justify-content:space-between; padding:22rpx; background:#f5f7f4; border-radius:18rpx; }
.reason-input { width:100%; min-height:150rpx; padding:22rpx; box-sizing:border-box; background:#f5f7f4; border-radius:18rpx; font-size:26rpx; }
.guardrail { color:#7b6940; font-size:22rpx; line-height:1.6; }.form-card button { margin:0; width:100%; }
.readonly { margin-top:28rpx; }.readonly-title { display:block; margin-bottom:10rpx; font-size:28rpx; font-weight:800; }
.error-card { color:#8f2828; background:#fff5f3; border-color:#f1d1cc; }.error-title,.error-copy { display:block; }.error-title { font-weight:800; }.error-copy { margin-top:10rpx; font-size:24rpx; line-height:1.6; }.error-card button { margin-top:20rpx; }
.state-card { text-align:center; }.state-title { display:block; margin-bottom:10rpx; font-weight:800; }
.closure-list { display:grid; gap:16rpx; }.closure-card { margin:0; }.closure-card.cancelled { opacity:.72; }.closure-court,.closure-time { display:block; }.closure-court { font-size:30rpx; font-weight:800; }.closure-time { margin-top:7rpx; color:#58635c; font-size:23rpx; }
.status-pill { flex:0 0 auto; padding:8rpx 14rpx; border-radius:999rpx; font-size:21rpx; }.status-pill.active { color:#17653d; background:#e7f4eb; }.status-pill.cancelled { color:#707873; background:#eef0ef; }
.closure-reason { display:block; margin-top:18rpx; font-size:26rpx; line-height:1.55; }.audit-line { display:block; margin-top:9rpx; color:#7b847e; font-size:21rpx; }
.compact { min-height:68rpx; margin:20rpx 0 0; line-height:68rpx; font-size:24rpx; }
</style>

<style scoped>
.sticky-error { position:sticky; top:0; z-index:15; }.form-card { padding-bottom:calc(150rpx + env(safe-area-inset-bottom)); }.form-card>button.primary { position:fixed; bottom:env(safe-area-inset-bottom); left:28rpx; right:28rpx; width:auto; z-index:20; margin:0; box-shadow:0 0 0 28rpx #fff; }
</style>
