<script setup lang="ts">
import { toRefs } from "vue";
import AppIcon from "../../../components/AppIcon.vue";

const props = defineProps<{
  tab: "games" | "events";
  showHostApplication: boolean;
  hostApplication: any;
  displayApplicationStatus: (status?: string) => string;
  isHost: boolean;
  openHostWorkbench: () => void;
  isMember: boolean;
  actionKey: string;
  loading: boolean;
  applyHost: () => Promise<void>;
}>();
const {
  tab,
  showHostApplication,
  hostApplication,
  displayApplicationStatus,
  isHost,
  openHostWorkbench,
  isMember,
  actionKey,
  loading,
  applyHost,
} = toRefs(props);
</script>

<template>
  <view>
    <view v-if="tab === 'games' && showHostApplication" class="card host-entry">
      <view class="host-copy">
        <view class="host-heading"
          ><view class="host-icon"><AppIcon name="add" :size="30" /></view
          ><text class="host-title">发起自己的球局</text></view
        >
        <text class="muted">申请通过后，可以组织球局并管理报名与签到。</text>
        <text v-if="hostApplication" class="application-state"
          >申请状态：{{
            displayApplicationStatus(hostApplication.status)
          }}</text
        >
      </view>
      <button
        v-if="isHost"
        class="primary host-button"
        @tap="openHostWorkbench"
      >
        <AppIcon name="work" :size="28" tone="inverse" />进入主理人工作台
      </button>
      <button
        v-else-if="isMember && hostApplication?.status !== 'APPLIED'"
        class="secondary host-button"
        :loading="actionKey === 'host-apply'"
        :disabled="loading || Boolean(actionKey)"
        @tap="applyHost"
      >
        <AppIcon name="add" :size="28" />申请成为主理人
      </button>
      <button v-else-if="isMember" class="secondary host-button" disabled>
        申请审核中
      </button>
    </view>
  </view>
</template>

<style scoped src="../page.css"></style>
