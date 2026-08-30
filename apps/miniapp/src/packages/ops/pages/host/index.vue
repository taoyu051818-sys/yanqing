<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import StatusBadge from '../../../../components/StatusBadge.vue'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { shortDate } from '../../../../utils/format'

const session = useSessionStore()
const games = ref<any[]>([])
const loading = ref(false)
const selectedGameId = ref('')

const selectedGame = computed(() => games.value.find((game) => game.id === selectedGameId.value) || games.value[0])
const registrations = computed(() => selectedGame.value?.registrations || [])
const checkedIn = computed(() => registrations.value.filter((item: any) => item.status === 'CHECKED_IN').length)
const pendingCheckIn = computed(() => registrations.value.filter((item: any) => item.status !== 'CHECKED_IN'))
const metrics = computed(() => [
  ['我的球局', String(games.value.length), '进行中与待开场'],
  ['已报名', String(registrations.value.length), '当前球局'],
  ['已签到', String(checkedIn.value), '以实到为准'],
  ['待结算', selectedGame.value?.status === 'COMPLETED' ? '0' : selectedGame.value ? '1' : '0', '激励发放'],
])

async function load() {
  await session.hydrate()
  loading.value = true
  const result = await endpoints.hostedGames()
  games.value = result || []
  if (!selectedGameId.value && games.value[0]) selectedGameId.value = games.value[0].id
  loading.value = false
}

function selectGame(game: any) { selectedGameId.value = game.id }

async function checkIn(player: any) {
  try {
    await endpoints.checkInGame(selectedGame.value.id, player.userId || player.id)
    player.status = 'CHECKED_IN'
    uni.showToast({ title: '已签到', icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '签到失败', icon: 'none' }) }
}

async function completeGame() {
  const game = selectedGame.value
  if (!game) return
  const modal = await uni.showModal({ title: '结束球局并结算', content: `按已签到 ${checkedIn.value} 人计算主理人羽毛球币激励，确认？` })
  if (!modal.confirm) return
  try { await endpoints.completeGame(game.id); game.status = 'COMPLETED'; uni.showToast({ title: '已完成结算', icon: 'success' }) }
  catch (cause: any) { uni.showToast({ title: cause.message || '结算失败', icon: 'none' }) }
}

onShow(load)
</script>

<template>
  <OperationsFrame title="球局运营" eyebrow="GAME OPERATIONS" role="主理人" description="先选定本人负责的球局，再按报名、实到、缺席和结束结算推进，不进入场馆财务后台。">
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>
    <view class="section-title">我的球局 <text class="section-note">{{ loading ? '同步中' : `${games.length} 场` }}</text></view>
    <scroll-view scroll-x class="game-tabs">
      <view v-for="game in games" :key="game.id" class="game-tab" :class="{ active: selectedGame?.id === game.id }" @tap="selectGame(game)">{{ game.title }}</view>
    </scroll-view>
    <view v-if="selectedGame" class="card game-summary">
      <view class="row"><view><text class="game-title">{{ selectedGame.title }}</text><text class="muted">{{ shortDate(selectedGame.startsAt) }} · {{ selectedGame.level || '公开组' }}</text></view><StatusBadge :value="selectedGame.status" /></view>
      <text class="muted summary-copy">{{ selectedGame.description || '按实际签到人数结算激励' }}</text>
      <button v-if="selectedGame.status !== 'COMPLETED'" class="primary" @tap="completeGame">结束球局并结算</button>
      <view v-else class="settled">已结束 · 激励已按实际签到人数结算</view>
    </view>
    <view class="section-title">报名与现场签到 <text class="section-note">已到 {{ checkedIn }} / {{ registrations.length }}</text></view>
    <view v-for="player in registrations" :key="player.id" class="card player-row">
      <view><text class="player-name">{{ player.displayName || player.user?.displayName || '报名球友' }}</text><text class="muted">报名状态：{{ player.status === 'CHECKED_IN' ? '已到场' : '待签到' }}</text></view>
      <button v-if="player.status !== 'CHECKED_IN' && selectedGame?.status !== 'COMPLETED'" class="secondary inline" @tap="checkIn(player)">签到</button><StatusBadge v-else :value="player.status" />
    </view>
    <view v-if="!loading && !registrations.length" class="empty card">当前球局暂无报名</view>
    <view class="card boundary"><text class="muted">结算规则：以实际签到人数为准；缺席不计入奖励。名单变更和结束操作都会写入审计记录。</text></view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }.section-note { color:#758079; font-size:22rpx; font-weight:400; }.game-tabs { white-space:nowrap; margin-bottom: 18rpx; }.game-tab { display:inline-block; max-width:400rpx; overflow:hidden; margin-right:12rpx; padding:18rpx 22rpx; color:#667169; background:#e8efea; border-radius:18rpx; text-overflow:ellipsis; white-space:nowrap; }.game-tab.active { color:#fff; background:#17653d; }.game-summary { padding:24rpx; }.game-title,.player-name { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; }.summary-copy { display:block; margin:18rpx 0; line-height:1.6; }.game-summary button { margin:0; }.settled { padding:18rpx; color:#17653d; background:#e8f4eb; border-radius:16rpx; text-align:center; }.player-row { display:flex; align-items:center; justify-content:space-between; gap:12rpx; margin-top:14rpx; padding:20rpx 24rpx; }.inline { min-width:108rpx; min-height:56rpx; margin:0; padding:0 14rpx; line-height:56rpx; font-size:22rpx; }.empty { color:#758079; text-align:center; }.boundary { margin-top:22rpx; line-height:1.7; }
</style>
