<script setup lang="ts">
import { toRefs } from "vue";
import MetricCard from "../../../../../components/MetricCard.vue";

const props = defineProps<{
  showAnalytics: boolean;
  dashboardError: string;
  load: () => Promise<void>;
  metrics: string[][];
  decisionPanels: { title: string; note: string; items: string[][] }[];
}>();
const { showAnalytics, dashboardError, load, metrics, decisionPanels } =
  toRefs(props);
</script>

<template>
  <view>
    <template v-if="showAnalytics">
      <view v-if="dashboardError" class="error card">
        <text class="error-title">经营指标同步失败</text>
        <text class="muted">{{ dashboardError }}</text>
        <button class="secondary retry" @tap="load">重试同步</button>
      </view>

      <view class="metric-grid">
        <MetricCard
          v-for="item in metrics"
          :key="item[0]"
          :label="item[0]"
          :value="item[1]"
          :note="item[2]"
        />
      </view>

      <view class="section-title"
        >老板驾驶舱 <text class="section-note">决策口径</text></view
      >
      <view class="decision-grid">
        <view
          v-for="panel in decisionPanels"
          :key="panel.title"
          class="card decision-panel"
        >
          <text class="decision-title">{{ panel.title }}</text>
          <text class="muted decision-note">{{ panel.note }}</text>
          <view class="decision-rows">
            <view
              v-for="item in panel.items"
              :key="item[0]"
              class="decision-row"
            >
              <text>{{ item[0] }}</text
              ><text class="decision-value">{{ item[1] }}</text>
            </view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
