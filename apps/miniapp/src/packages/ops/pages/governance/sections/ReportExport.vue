<script setup lang="ts">
import { toRefs } from "vue";

const props = defineProps<{
  exportScopes:
    | readonly [
        readonly ["orders", "订单与支付"],
        readonly ["members", "会员与账户"],
        readonly ["training", "培训运营"],
        readonly ["events", "赛事经营"],
        readonly ["alliance", "联盟商户"],
        readonly ["inventory", "商品库存"],
        readonly ["finance", "财务结算"],
        readonly ["audit", "审计与关账"],
        readonly ["all", "全量审计包"],
      ]
    | (
        | readonly ["orders", "订单与支付"]
        | readonly ["members", "会员与账户"]
        | readonly ["training", "培训运营"]
        | readonly ["events", "赛事经营"]
        | readonly ["alliance", "联盟商户"]
        | readonly ["inventory", "商品库存"]
        | readonly ["finance", "财务结算"]
        | readonly ["audit", "审计与关账"]
        | readonly ["all", "全量审计包"]
      )[];
  acting: string;
  exportReport: (scope: string) => Promise<void>;
}>();
const { exportScopes, acting, exportReport } = toRefs(props);
</script>

<template>
  <view>
    <view class="card notice"
      >导出由 API 生成真实 XLSX 并写入审计。mock 模式不会伪造报表；remote
      模式下可直接打开或转发。</view
    >
    <view class="export-grid"
      ><button
        v-for="scope in exportScopes"
        :key="scope[0]"
        class="export"
        :loading="acting === `export:${scope[0]}`"
        @tap="exportReport(scope[0])"
      >
        {{ scope[1] }}
      </button></view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
