<script setup lang="ts">
import ActionDialog from "./ActionDialog.vue";
import MemberDirectorySearch from "./MemberDirectorySearch.vue";
import type { MemberDirectoryItem } from "../types/domain";
withDefaults(defineProps<{ title?: string; note?: string }>(), {
  title: "选择代订会员",
  note: "请核对姓名和手机号，订单将归属所选会员。",
});
const emit = defineEmits<{
  select: [member: MemberDirectoryItem];
  close: [];
}>();
</script>
<template>
  <ActionDialog :title="title" @close="emit('close')"
    ><MemberDirectorySearch
      :note="note"
      @select="emit('select', $event)"
    /><template #footer
      ><button class="secondary" @tap="emit('close')">
        取消选择
      </button></template
    ></ActionDialog
  >
</template>
<style scoped>
button {
  width: 100%;
  min-height: 48px;
  margin: 0;
  font-size: 28rpx;
}
</style>
