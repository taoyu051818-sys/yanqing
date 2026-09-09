<script setup lang="ts">
import { toRefs, computed } from "vue";
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
</script>

<template>
  <view>
    <template v-if="activeTab === 'audit'">
      <view class="card toolbar"
        ><input
          v-model="auditObjectType"
          placeholder="对象类型，如 Order"
        /><button size="mini" @tap="loadCurrentTab">筛选</button></view
      >
      <SectionEmpty
        v-if="!auditLogs.length"
        title="没有审计日志"
        description="有权限的业务状态动作会记录操作者、前后值和原因。"
      />
      <view v-for="item in auditLogs" :key="item.id" class="card data-card"
        ><view class="row"
          ><text class="strong">{{ item.action }}</text
          ><StatusBadge :value="item.result || 'SUCCESS'" /></view
        ><text class="muted small"
          >{{ item.objectType }} / {{ item.objectId || "-" }} ·
          {{ item.actor?.displayName || "系统" }} ·
          {{ shortDate(item.createdAt) }}</text
        ><text v-if="item.reason" class="reason"
          >原因：{{ item.reason }}</text
        ></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
