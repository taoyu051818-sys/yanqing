<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { money, shortDate } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const session = useSessionStore()
const tab = ref<'games' | 'events'>('games')
const games = ref<any[]>([])
const events = ref<any[]>([])
const loading = ref(false)

async function load() {
  if (!session.isAuthenticated && !(await session.hydrate())) return
  loading.value = true
  try { [games.value, events.value] = await Promise.all([endpoints.games(), endpoints.events()]) }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
  finally { loading.value = false }
}

async function joinGame(game: any) {
  try {
    const command = { gameId: game.id, sourceChannel: 'MINI_PROGRAM' }
    const result: any = await withPendingCreationKey('game.register', command, (creationIdempotencyKey) =>
      endpoints.registerGame(game.id, creationIdempotencyKey),
    )
    if (result?.status === 'WAITLISTED' || result?.registration?.status === 'WAITLISTED') {
      uni.showModal({
        title: '已进入候补',
        content: `当前候补第 ${result.waitlistPosition || '—'} 位。有名额释放时会通知你，再完成支付。`,
        showCancel: false,
      })
      await load()
      return
    }
    uni.showModal({ title: '报名成功', content: `已生成订单 ${result.orderNo}，请前往订单支付。`, showCancel: false })
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}

async function joinEvent(event: any) {
  const input = await new Promise<string>((resolve) => {
    uni.showModal({ title: '报名固定双打', editable: true, placeholderText: '队名/两位队员，以 / 分隔', success: (result) => resolve(result.confirm ? result.content || '' : '') })
  })
  if (!input) return
  const [teamName, playerAName, playerBName] = input.split('/').map((value) => value.trim())
  if (!teamName || !playerAName || !playerBName) return uni.showToast({ title: '请按 队名/队员A/队员B 填写', icon: 'none' })
  const categoryResult = await uni.showActionSheet({ itemList: ['男双', '女双', '混双'] })
  const category = ['MEN_DOUBLES', 'WOMEN_DOUBLES', 'MIXED_DOUBLES'][categoryResult.tapIndex]
  try {
    const command = {
      eventId: event.id,
      name: teamName,
      playerAName,
      playerBName,
      category,
      sourceChannel: 'MINI_PROGRAM',
    }
    const order: any = await withPendingCreationKey('event.register', command, (creationIdempotencyKey) =>
      endpoints.registerEvent(event.id, { name: teamName, playerAName, playerBName, category, creationIdempotencyKey }),
    )
    uni.showModal({ title: '赛事报名已提交', content: `订单 ${order.orderNo} 待支付`, showCancel: false })
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}

onShow(load)
</script>

<template>
  <view class="page safe-bottom">
    <view class="tabs">
      <view :class="{ active: tab === 'games' }" @tap="tab = 'games'">日常球局</view>
      <view :class="{ active: tab === 'events' }" @tap="tab = 'events'">金羽积分赛</view>
    </view>

    <template v-if="tab === 'games'">
      <view v-for="game in games" :key="game.id" class="card activity">
        <view class="row"><StatusBadge :value="game.status" /><text class="muted">{{ shortDate(game.startsAt) }}</text></view>
        <text class="title">{{ game.title }}</text>
        <text class="muted">主理人 {{ game.host?.displayName }} · {{ game.level }} · {{ game._count?.registrations || 0 }}/{{ game.capacity }} 人</text>
        <view class="row footer"><text class="money">{{ money(game.feeCents) }}</text><button class="secondary join" @tap="joinGame(game)">立即报名</button></view>
      </view>
      <SectionEmpty v-if="!games.length && !loading" title="暂无开放球局" />
    </template>

    <template v-else>
      <view class="rules card">
        <text class="rules-title">固定双打 · 五轮瑞士制</text>
        <text class="muted">单局21分，20平不加分；男双对女双让5分，男双对混双让2分，混双对女双让2分。</text>
      </view>
      <view v-for="event in events" :key="event.id" class="card activity">
        <view class="row"><StatusBadge :value="event.status" /><text class="muted">{{ shortDate(event.startsAt) }}</text></view>
        <text class="title">{{ event.name }}</text>
        <text class="muted">{{ event.minimumPeople }}人成赛 · {{ event.capacityPeople }}人封顶 · {{ event.totalRounds }}轮</text>
        <view class="row footer"><text class="money">{{ money(event.feeCents) }}</text><button class="secondary join" @tap="joinEvent(event)">固定搭档报名</button></view>
      </view>
      <SectionEmpty v-if="!events.length && !loading" title="赛事筹备中" />
    </template>
  </view>
</template>

<style scoped>
.tabs { display: grid; grid-template-columns: 1fr 1fr; padding: 8rpx; margin-bottom: 26rpx; background: #e7ece8; border-radius: 22rpx; text-align: center; }
.tabs view { padding: 20rpx; color: #788079; border-radius: 17rpx; }
.tabs .active { color: #174b30; background: #fff; box-shadow: 0 6rpx 18rpx rgba(29,67,44,.08); font-weight: 700; }
.activity .title { display: block; margin: 26rpx 0 12rpx; font-size: 34rpx; font-weight: 800; }
.footer { margin-top: 26rpx; }
.join { min-width: 190rpx; padding: 0 20rpx; margin: 0; }
.rules { background: linear-gradient(135deg,#153f2a,#23714a); }
.rules-title { display: block; margin-bottom: 12rpx; color: #fff; font-size: 31rpx; font-weight: 700; }
.rules .muted { color: rgba(255,255,255,.76); line-height: 1.7; }
</style>
