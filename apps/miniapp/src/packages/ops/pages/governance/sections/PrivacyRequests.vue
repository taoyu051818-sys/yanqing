<script setup lang="ts">
import { toRefs } from "vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { GovernanceTab } from "../../../config/governance";
import { shortDate } from "../../../../../utils/format";

const props = defineProps<{
  activeTab: GovernanceTab;
  erasureRequests: any[];
  acting: string;
  inspectErasure: (request: any) => Promise<void>;
  erasureBlockers: Record<string, any[]>;
  canCompleteErasure: boolean;
  erasureReasons: Record<string, string>;
  decideErasure: (request: any, action: "reject" | "complete") => Promise<void>;
}>();
const {
  activeTab,
  erasureRequests,
  acting,
  inspectErasure,
  erasureBlockers,
  canCompleteErasure,
  erasureReasons,
  decideErasure,
} = toRefs(props);
</script>

<template>
  <view>
    <template v-if="activeTab === 'privacy'">
      <view class="card notice"
        >注销不是物理删除。先停用账号、移交岗位并结清余额/订单/退款/课包/报名/券，再由非申请人的超级管理员复核；历史财务凭证和审计仅保留匿名内部编号。</view
      >
      <SectionEmpty
        v-if="!erasureRequests.length"
        title="暂无注销申请"
        description="会员从个人中心提交后会进入这里；管理员可检查阻断项，只有超级管理员可完成不可逆匿名化。"
      />
      <view
        v-for="request in erasureRequests"
        :key="request.id"
        class="card data-card"
      >
        <view class="row"
          ><view
            ><text class="strong">{{
              request.user?.displayName || request.userId
            }}</text
            ><text class="muted small"
              >{{ request.user?.phone || "手机号未登记/已去除" }} · 申请于
              {{ shortDate(request.requestedAt) }}</text
            ></view
          ><StatusBadge :value="request.status"
        /></view>
        <text class="reason">申请原因：{{ request.reason }}</text>
        <text v-if="request.reviewReason" class="reason"
          >复核原因：{{ request.reviewReason }}</text
        >
        <view v-if="request.status === 'REQUESTED'" class="actions"
          ><button
            size="mini"
            :loading="acting === `erasure:blockers:${request.id}`"
            @tap="inspectErasure(request)"
          >
            检查结清条件
          </button></view
        >
        <view v-if="erasureBlockers[request.id]?.length" class="blocker-list"
          ><text
            v-for="item in erasureBlockers[request.id]"
            :key="item.code"
            class="blocker"
            >{{ item.message }}（{{ item.count }}）</text
          ></view
        >
        <template v-if="request.status === 'REQUESTED' && canCompleteErasure">
          <textarea
            v-model="erasureReasons[request.id]"
            class="textarea"
            maxlength="300"
            placeholder="复核原因（必填）"
          />
          <view class="actions"
            ><button size="mini" @tap="decideErasure(request, 'reject')">
              驳回</button
            ><button
              size="mini"
              class="danger"
              :disabled="Boolean(erasureBlockers[request.id]?.length)"
              :loading="acting === `erasure:complete:${request.id}`"
              @tap="decideErasure(request, 'complete')"
            >
              完成匿名化
            </button></view
          >
        </template>
        <text v-else-if="request.status === 'REQUESTED'" class="notice"
          >管理员可检查；只有超级管理员可驳回或完成匿名化。</text
        >
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
