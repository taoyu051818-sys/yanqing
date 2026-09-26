<script setup lang="ts">
import type { TrainingSessionView } from '@yanqing/shared'
import AppIcon from '../../../../../components/AppIcon.vue'
import StatusBadge from '../../../../../components/StatusBadge.vue'
import { dateTimeRange } from '../../../../../utils/format'
import OperationsTabs from '../../../components/OperationsTabs.vue'
defineProps<{ filter: string; search: string; lessons: TrainingSessionView[]; loading: boolean; hasMore: boolean; error: string; canCreate: boolean; studentsFor: (lesson: TrainingSessionView) => any[] }>()
const emit = defineEmits<{ 'update:filter': [value: string]; 'update:search': [value: string]; open: [id: string]; create: []; more: []; retry: [] }>()
const dateFilters = [{ key:'today', title:'今日' }, { key:'tomorrow', title:'明日' }, { key:'all', title:'全部' }]
</script>
<template>
  <view class="lesson-list">
    <view class="list-heading"><text>课表</text><button v-if="canCreate" class="primary" @tap="emit('create')"><AppIcon name="add" :size="30" tone="inverse" />排课</button></view>
    <OperationsTabs :model-value="filter" :items="dateFilters" label="课表日期" @update:model-value="emit('update:filter', $event)" />
    <view class="search"><AppIcon name="search" :size="32" tone="muted" /><input :value="search" placeholder="搜索课程名称" aria-label="搜索课程名称" @input="emit('update:search', ($event.detail as any).value)" /></view>
    <view v-if="error" class="empty" role="alert"><text>{{ error }}</text><button class="secondary" :disabled="loading" @tap="emit('retry')">重试</button></view>
    <view v-if="loading && !lessons.length" class="empty">正在加载课表…</view>
    <view v-else-if="!error && !lessons.length" class="empty">当前条件下没有课次，可切换日期或搜索条件。</view>
    <view v-else class="records"><button v-for="lesson in lessons" :key="lesson.id" class="lesson-row" @tap="emit('open', lesson.id)"><view class="lesson-copy"><text class="lesson-name">{{ lesson.class?.name || '培训课次' }}</text><text class="lesson-meta">{{ dateTimeRange(lesson.startsAt, lesson.endsAt) }}</text><text class="lesson-meta">{{ studentsFor(lesson).length }} 位学员 · 查看点名与消课</text></view><StatusBadge :value="lesson.status" domain="training" /><AppIcon name="chevron" :size="28" tone="muted" /></button></view>
    <button v-if="hasMore && !error" class="secondary load-more" :disabled="loading" @tap="emit('more')">{{ loading ? '加载中…' : '加载更多课次' }}</button>
  </view>
</template>
<style scoped>
.load-more { margin-top:24rpx; min-height:88rpx; }
.list-heading { display:flex; justify-content:space-between; align-items:center; margin:8rpx 0 24rpx; font-size:34rpx; font-weight:600; }.list-heading button { margin:0; padding:16rpx 24rpx; font-size:28rpx; }
.search { display:flex; gap:16rpx; align-items:center; padding:0 24rpx; background:#fff; border-radius:20rpx; margin-bottom:24rpx; }.search input { flex:1; min-width:0; height:96rpx; font-size:30rpx; }
.records { overflow:hidden; background:#fff; border-radius:24rpx; }.lesson-row { display:flex; align-items:center; gap:16rpx; width:100%; margin:0; padding:30rpx 24rpx; text-align:left; background:#fff; border-radius:0; }.lesson-row+.lesson-row { border-top:1rpx solid #e8ece9; }.lesson-row::after { border:0; }.lesson-copy { flex:1; min-width:0; }.lesson-name { display:block; font-size:32rpx; font-weight:550; color:#20252b; }.lesson-meta { display:block; margin-top:8rpx; font-size:25rpx; color:#626d66; }.empty { padding:48rpx 24rpx; text-align:center; color:#626d66; font-size:28rpx; background:#fff; border-radius:24rpx; }
</style>
