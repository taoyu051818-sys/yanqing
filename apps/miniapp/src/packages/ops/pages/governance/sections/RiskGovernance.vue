<script setup lang="ts">
import { toRefs } from "vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { GovernanceTab } from "../../../config/governance";
import { shortDate } from "../../../../../utils/format";

const props = defineProps<{
  activeTab: GovernanceTab;
  risks: any[];
  riskReasons: Record<string, string>;
  acting: string;
  actRisk: (
    risk: any,
    action: "review" | "resolve" | "dismiss",
  ) => Promise<void>;
  canResolveRisk: boolean;
}>();
const { activeTab, risks, riskReasons, acting, actRisk, canResolveRisk } =
  toRefs(props);
</script>

<template>
  <view>
    <template v-if="activeTab === 'risks'">
      <SectionEmpty
        v-if="!risks.length"
        title="暂无风险事件"
        description="支付、退款、券码等规则触发的异常会进入此队列。"
      />
      <view v-for="risk in risks" :key="risk.id" class="card data-card"
        ><view class="row"
          ><view
            ><text class="strong">{{ risk.summary }}</text
            ><text class="muted small"
              >{{ risk.ruleCode }} · {{ risk.objectType }} ·
              {{ shortDate(risk.createdAt) }}</text
            ></view
          ><StatusBadge :value="risk.status" /></view
        ><text class="risk-level">风险等级：{{ risk.severity }}</text
        ><input
          v-if="!['RESOLVED', 'DISMISSED'].includes(risk.status)"
          v-model="riskReasons[risk.id]"
          class="field"
          placeholder="处理原因（必填）"
        /><view
          v-if="!['RESOLVED', 'DISMISSED'].includes(risk.status)"
          class="actions"
          ><button
            v-if="risk.status === 'OPEN'"
            size="mini"
            :loading="acting === `risk:${risk.id}`"
            @tap="actRisk(risk, 'review')"
          >
            进入复核</button
          ><button
            v-if="canResolveRisk"
            size="mini"
            class="primary"
            @tap="actRisk(risk, 'resolve')"
          >
            确认解决</button
          ><button
            v-if="canResolveRisk"
            size="mini"
            @tap="actRisk(risk, 'dismiss')"
          >
            排除误报
          </button></view
        ></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
