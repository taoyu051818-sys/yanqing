<script setup lang="ts">
import { toRefs, computed, ref } from "vue";
import MetricCard from "../../../components/MetricCard.vue";

const props = defineProps<{
  showAnalytics: boolean;
  dashboardError: string;
  load: () => Promise<void>;
  metrics: string[][];
  decisionPanels: { title: string; note: string; items: string[][] }[];
}>();
const { showAnalytics, dashboardError, load, metrics, decisionPanels } =
  toRefs(props);
const primaryLabels = ['已实现收入', '总出租率', '培训现金毛利', '统一待办'];
const primaryMetrics = computed(() => primaryLabels.flatMap(label => props.metrics.filter(item => item[0] === label)));
const moreMetrics = computed(() => props.metrics.filter(item => !primaryLabels.includes(item[0])));
const showMoreMetrics = ref(false);
const expandedPanel = ref('');
function openQueue() { uni.navigateTo({ url: '/packages/ops/pages/admin/index' }); }
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
          v-for="item in primaryMetrics"
          :key="item[0]"
          :label="item[0]"
          :value="item[1]"
          :note="item[2]"
        />
      </view>

      <button class="secondary analytics-toggle" @tap="openQueue">查看待办并处理 ›</button>
      <button class="analytics-toggle" :aria-expanded="showMoreMetrics" @tap="showMoreMetrics = !showMoreMetrics">{{ showMoreMetrics ? '收起更多指标' : '更多经营指标' }}</button>
      <view v-if="showMoreMetrics" class="metric-grid">
        <MetricCard v-for="item in moreMetrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" />
      </view>
      <view class="section-title">经营明细</view>
      <view class="decision-grid">
        <view
          v-for="panel in decisionPanels"
          :key="panel.title"
          class="card decision-panel"
        >
          <button class="analytics-toggle panel-toggle" :aria-expanded="expandedPanel === panel.title" @tap="expandedPanel = expandedPanel === panel.title ? '' : panel.title">
            <text class="decision-title">{{ panel.title }}</text><text>{{ expandedPanel === panel.title ? '收起' : '查看' }} ›</text>
          </button>
          <template v-if="expandedPanel === panel.title">
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
          </template>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.analytics-toggle { margin: 0 0 16rpx; min-height: 44px; background: #fff; color: #17653d; font-size: 15px; text-align: left; }
.panel-toggle { display:flex; align-items:center; justify-content:space-between; gap:16rpx; padding:0; margin:0; width:100%; }
.decision-panel { margin-bottom:12rpx; }
.analytics-toggle::after { border:0; }
</style>
