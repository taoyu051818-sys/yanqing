<script setup lang="ts">
import { toRefs, computed, ref } from "vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { GovernanceTab } from "../../../config/governance";
import { shortDate } from "../../../../../utils/format";

const props = defineProps<{
  activeTab: GovernanceTab;
  auditObjectType: string;
  loadCurrentTab: () => Promise<void>;
  auditLogs: any[];
}>();
const emit = defineEmits<{
  (event: "update:auditObjectType", value: string): void;
}>();
const { activeTab, loadCurrentTab, auditLogs } = toRefs(props);
const auditObjectType = computed({
  get: () => props.auditObjectType,
  set: (value) => emit("update:auditObjectType", value),
});
const expanded = ref('');
const objectTypes = [
  { value:'', label:'全部业务' }, { value:'Order', label:'订单' }, { value:'User', label:'会员与员工' },
  { value:'Payment', label:'支付' }, { value:'Refund', label:'退款' }, { value:'SystemParameter', label:'业务规则' },
  { value:'TrainingSession', label:'培训课次' }, { value:'InventoryTxn', label:'库存操作' },
];
const actions: Record<string, string> = {
  TRAINING_ORDER_AUTO_CANCELLED:'课程订单超时取消', PARAMETER_VERSION_CREATED:'创建规则版本',
  REFUND_APPROVED:'批准退款', REFUND_REJECTED:'驳回退款', VENUE_COURT_CREATED:'新增场地',
  VENUE_COURT_UPDATED:'更新场地', VENUE_COURT_DELETED:'删除场地', USER_ROLES_UPDATED:'修改员工权限',
  ORDER_CREATED:'创建订单', ORDER_CANCELLED:'取消订单', REPORT_EXPORTED:'导出业务报表',
};
function objectLabel(value: string) { return objectTypes.find(item => item.value === value)?.label || '业务记录'; }
function selectObject(event: any) { auditObjectType.value = objectTypes[Number(event.detail.value)]?.value || ''; void loadCurrentTab.value(); }
</script>

<template>
  <view>
    <template v-if="activeTab === 'audit'">
      <view class="card toolbar"><picker :range="objectTypes" range-key="label" :value="Math.max(0, objectTypes.findIndex(item => item.value === auditObjectType))" @change="selectObject"><view class="audit-picker">{{ objectTypes.find(item => item.value === auditObjectType)?.label || '全部业务' }} · 选择业务范围</view></picker></view>
      <SectionEmpty
        v-if="!auditLogs.length"
        title="没有审计日志"
        description="有权限的业务状态动作会记录操作者、前后值和原因。"
      />
      <view v-for="item in auditLogs" :key="item.id" class="card data-card"
        ><view class="row"
          ><text class="strong">{{ actions[item.action] || `${objectLabel(item.objectType)}操作` }}</text
          ><StatusBadge :value="item.result || 'SUCCESS'" /></view
        ><text class="muted small"
          >{{ objectLabel(item.objectType) }} ·
          {{ item.actor?.displayName || "系统" }} ·
          {{ shortDate(item.createdAt) }}</text
        ><text v-if="item.reason" class="reason"
          >原因：{{ item.reason }}</text
        ><button class="audit-more" @tap="expanded = expanded === item.id ? '' : item.id">{{ expanded === item.id ? '收起记录信息' : '查看记录信息' }}</button><text v-if="expanded === item.id" class="muted">操作标识：{{ item.action }} · 记录编号：{{ item.objectId || '—' }}</text></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>.audit-picker { padding:12rpx; font-size:28rpx; }.audit-more { margin:16rpx 0 0; padding:12rpx; background:transparent; color:#17653d; font-size:26rpx; }</style>
