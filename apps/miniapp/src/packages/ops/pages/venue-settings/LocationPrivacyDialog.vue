<script setup lang="ts">
import { ref } from 'vue'
import ActionDialog from '../../../../components/ActionDialog.vue'
defineProps<{ contractName: string }>()
defineEmits<{ agree: []; decline: [] }>()
const error = ref('')
function openContract() {
  error.value = ''
  try {
    uni.openPrivacyContract({
      fail: () => {
        error.value = '隐私指引暂时无法打开，请稍后重试。'
      },
    })
  } catch {
    error.value = '隐私指引暂时无法打开，请稍后重试。'
  }
}
</script>
<template>
  <ActionDialog title="地图选点授权" @close="$emit('decline')">
    <view class="privacy-copy">
      <text>选点将使用位置信息，帮助你在地图上设置球馆地址。仅保存你确认的球馆位置，用于会员到馆导航。</text>
      <button class="secondary" @tap="openContract">阅读{{ contractName }}</button>
      <text v-if="error" role="alert">{{ error }}</text>
      <text>你也可以取消授权，直接填写文字地址。</text>
    </view>
    <template #footer>
      <button class="secondary" @tap="$emit('decline')">暂不授权</button>
      <button
        id="venue-location-privacy-agree"
        class="primary"
        open-type="agreePrivacyAuthorization"
        @agreeprivacyauthorization="$emit('agree')"
      >
        同意并继续
      </button>
    </template>
  </ActionDialog>
</template>
<style scoped>
.privacy-copy {
  display: grid;
  gap: 24rpx;
  line-height: 1.7;
}
</style>
