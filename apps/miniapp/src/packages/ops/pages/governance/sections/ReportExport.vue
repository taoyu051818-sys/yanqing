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
      >选择需要导出的业务范围，生成后可打开或转发 Excel 文件。导出操作会留下记录。</view
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
