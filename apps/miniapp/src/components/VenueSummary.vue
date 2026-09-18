<script setup lang="ts">
import type { VenueProfile } from '../types/venue-settings'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ profile: VenueProfile | null; error?: string }>()
const hour = (value: number) => `${String(Math.floor(value)).padStart(2, '0')}:${String(Math.round((value % 1) * 60)).padStart(2, '0')}`
function openMap() {
  const p = props.profile
  if (!p || p.latitude == null || p.longitude == null) return
  uni.openLocation({ latitude: p.latitude, longitude: p.longitude, name: p.name, address: p.address, fail: () => uni.showToast({ title: '地图暂时无法打开，请按地址前往', icon: 'none' }) })
}
function callVenue() { if (props.profile?.contactPhone) uni.makePhoneCall({ phoneNumber: props.profile.contactPhone }) }
</script>
<template>
  <view v-if="profile" class="card venue-summary">
    <view class="venue-title"><AppIcon name="sport" :size="36" /><text>{{ profile.name }}</text></view>
    <text class="muted">{{ profile.opensAtHour != null && profile.closesAtHour != null ? `每日 ${hour(profile.opensAtHour)}–${hour(profile.closesAtHour)}` : '营业时间待配置' }} · {{ profile.courtCount }} 片开放场地</text>
    <text class="venue-address">{{ profile.address || '详细地址待球馆补充' }}</text>
    <view v-if="profile.contactPhone || (profile.latitude != null && profile.longitude != null)" class="venue-actions">
      <button v-if="profile.latitude != null && profile.longitude != null" class="secondary" @tap="openMap">地图导航</button>
      <button v-if="profile.contactPhone" class="secondary" @tap="callVenue">联系球馆 · {{ profile.contactPhone }}</button>
    </view>
  </view>
  <view v-else-if="error" class="card muted">{{ error }}</view>
</template>
<style scoped>
.venue-summary { display:grid; gap:12rpx; margin-bottom:24rpx; }
.venue-title { display:flex; align-items:center; gap:12rpx; font-size:32rpx; font-weight:750; color:var(--color-primary-strong); }
.venue-title text,.venue-address { min-width:0; overflow-wrap:anywhere; }
.venue-address { font-size:25rpx; line-height:1.6; }
.venue-actions { display:flex; flex-wrap:wrap; gap:12rpx; }
.venue-actions button { flex:1; margin:0; min-height:88rpx; font-size:25rpx; }
</style>
