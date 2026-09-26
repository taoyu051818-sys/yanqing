<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { appBuild, readAppVersion, checkServiceConnection } from '../../utils/app-version';
const info = readAppVersion();
const busy = ref(false);
const status = ref('');
const failed = ref(false);
const serverRevision = ref('');
let alive = true;
onUnmounted(() => { alive = false; });
async function check() {
  if (busy.value) return;
  busy.value = true; status.value = ''; failed.value = false; serverRevision.value = '';
  try {
    const revision = await checkServiceConnection();
    if (alive) { serverRevision.value = revision.slice(0, 7); status.value = '连接正常'; }
  } catch (cause) {
    if (alive) { failed.value = true; status.value = cause instanceof Error ? cause.message : '暂时无法连接，请重试。'; }
  } finally { if (alive) busy.value = false; }
}
function copy() {
  uni.setClipboardData({ data: [
    '金羽会员 ' + info.version + '（' + info.environment + '）',
    '构建版本：' + info.buildVersion,
    '版本标识：' + info.revision,
    ...(serverRevision.value ? ['服务标识：' + serverRevision.value] : []),
  ].join('\n'), fail: () => uni.showToast({ title: '复制失败，请重试', icon: 'none' }) });
}
</script>
<template>
  <view class="about-version card">
    <text class="about-title">金羽会员</text>
    <text class="about-version-number">{{ info.version }}</text>
    <text class="about-environment">{{ info.environment }}</text>
    <view class="about-row"><text>版本标识</text><text>{{ info.revision }}</text></view>
    <view v-if="info.versionMismatch" class="about-row"><text>构建版本</text><text>{{ info.buildVersion }}</text></view>
    <text class="about-note">反馈问题时可复制版本信息，方便核对你正在使用的版本。</text>
    <button class="secondary" @tap="copy">复制版本信息</button>
    <button v-if="appBuild.dataMode === 'remote'" class="secondary" :loading="busy" :disabled="busy" @tap="check">检查服务连接</button>
    <text v-if="status" class="about-status" :class="{ 'about-error': failed }" role="status">{{ status }}</text>
    <text v-if="serverRevision" class="about-note">服务标识 {{ serverRevision }}</text>
    <text class="about-note">体验版与正式版可能不同。检查连接仅确认服务可用，不代表已更新到最新版本。</text>
  </view>
</template>
<style scoped>
.about-version { display: flex; flex-direction: column; gap: 24rpx; }
.about-title { font-size: 36rpx; font-weight: 700; text-align: center; }
.about-version-number { font-size: 44rpx; font-weight: 650; text-align: center; }
.about-environment { color: var(--color-primary); text-align: center; }
.about-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16rpx; font-size: 28rpx; }
.about-note { font-size: 26rpx; line-height: 1.6; color: var(--color-muted); }
.about-version button { width: 100%; margin: 0; min-height: 48px; }
.about-status { color: var(--color-primary); font-size: 28rpx; }
.about-error { color: var(--color-danger); }
</style>
