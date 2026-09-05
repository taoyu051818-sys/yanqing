<script setup lang="ts">
import { nextTick, reactive } from 'vue'
import type { useOperationTask } from './operation-task'
const props = defineProps<{ task: ReturnType<typeof useOperationTask> }>()
const keywords = reactive<Record<string, string>>({})
const customReasons = reactive<Record<string, boolean>>({})
function validateEdited(key: string) {
  if (props.task.state.errors[key]) void nextTick(() => props.task.validate(key))
}
function select(key: string, value: string) {
  props.task.state.values[key] = value
  delete props.task.state.errors[key]
}
</script>

<template>
  <view v-if="task.state.open || task.state.result" id="operation-task" class="operation-task">
    <view v-if="!task.state.open" role="status" class="task-result">
      <text>{{ task.state.result }}</text>
      <button @tap="task.state.result = ''">知道了，继续处理</button>
    </view>
    <template v-else>
      <text class="task-title">{{ task.state.title }}</text>
      <text class="task-description">{{ task.state.description }}</text>
      <view v-for="field in task.state.fields" :key="field.key" :id="'task-field-' + field.key" class="task-field">
        <text :id="'task-label-' + field.key" class="task-label">{{ field.label }}{{ field.required === false ? '（选填）' : '（必填）' }}</text>
        <text v-if="field.hint" class="task-hint">{{ field.hint }}</text>
        <view v-if="field.kind === 'search'" class="task-search">
          <input v-model="keywords[field.key]" :aria-label="'搜索' + field.label" :disabled="task.state.busy" placeholder="输入姓名搜索" maxlength="50" confirm-type="search" @confirm="task.search(field.key, keywords[field.key])" />
          <button :disabled="task.state.busy || task.state.searches[field.key]?.loading" @tap="task.search(field.key, keywords[field.key])">搜索</button>
        </view>
        <view v-if="['choices','search','reason'].includes(field.kind || '')" class="task-options">
          <button v-for="option in (field.optionsFor ? field.optionsFor(task.state.values) : field.options)" :key="option.value" :aria-pressed="task.state.values[field.key] === option.value" :disabled="task.state.busy" @tap="customReasons[field.key] = false; select(field.key, option.value)">
            <text>{{ task.state.values[field.key] === option.value ? '已选 · ' : '' }}{{ option.label }}</text>
            <text v-if="option.description" class="task-hint">{{ option.description }}</text>
          </button>
          <button v-if="field.kind === 'reason' && field.options?.length" :disabled="task.state.busy" @tap="customReasons[field.key] = true; select(field.key, '')">其他原因，补充说明</button>
        </view>
        <template v-if="field.kind === 'search'">
          <text v-if="task.state.searches[field.key]?.loading" role="status" class="task-hint">正在查询可选记录…</text>
          <text v-else-if="!field.options?.length && !task.state.searches[field.key]?.error" class="task-hint">没有匹配结果，请换个姓名搜索。</text>
          <text v-if="task.state.searches[field.key]?.error" class="task-error" role="alert">{{ task.state.searches[field.key].error }}</text>
          <button v-if="(field.options?.length || 0) < (task.state.searches[field.key]?.total || 0)" :disabled="task.state.busy || task.state.searches[field.key]?.loading" @tap="task.search(field.key, task.state.searches[field.key]?.keyword, true)">查看更多</button>
        </template>
        <textarea v-if="!['choices','search','number','money'].includes(field.kind || '') && (field.kind !== 'reason' || customReasons[field.key] || !field.options?.length)" v-model="task.state.values[field.key]" :focus="task.state.focusKey === field.key" @input="validateEdited(field.key)" @blur="task.validate(field.key)" :aria-labelledby="'task-label-' + field.key" :aria-describedby="'task-error-' + field.key" :disabled="task.state.busy" :maxlength="field.max || 500" auto-height />
        <input v-if="field.kind === 'number' || field.kind === 'money'" v-model="task.state.values[field.key]" :focus="task.state.focusKey === field.key" @input="validateEdited(field.key)" @blur="task.validate(field.key)" :type="field.kind === 'money' ? 'digit' : 'number'" :aria-labelledby="'task-label-' + field.key" :aria-describedby="'task-error-' + field.key" :disabled="task.state.busy" maxlength="12" />
        <text :id="'task-error-' + field.key" class="task-error field-error" aria-live="polite">{{ task.state.errors[field.key] }}</text>
      </view>
      <text v-if="task.state.error" class="task-error" role="alert">{{ task.state.error }}。内容已保留，可修改后重试。</text>
      <view class="task-actions">
        <button :disabled="task.state.busy" @tap="task.cancel">暂不处理</button>
        <button class="primary" :loading="task.state.busy" :disabled="task.state.busy || Object.values(task.state.searches).some(item => item.loading)" @tap="task.submit">{{ task.state.confirmText }}</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.operation-task { scroll-margin-top:64px; margin:24rpx 0; padding:28rpx; border:2rpx solid var(--color-primary); border-radius:24rpx; background:var(--color-card,#fff); color:var(--color-foreground,#18221c); overflow-wrap:anywhere; }
.task-title,.task-description,.task-label,.task-hint,.task-error { display:block; line-height:1.65; }
.field-error { min-height:1.65em; }
.task-title { font-size:34rpx; font-weight:800; }.task-description { margin:12rpx 0 24rpx; font-size:28rpx; }.task-label { font-weight:700; font-size:28rpx; }.task-hint { color:var(--color-muted-foreground,#5f6f65); font-size:25rpx; }
.task-field { margin:24rpx 0; min-width:0; }.task-options { display:flex; flex-wrap:wrap; gap:16rpx; margin:16rpx 0; }
.operation-task button { display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:44px; height:auto; margin:0; padding:16rpx 20rpx; font-size:27rpx; line-height:1.6; white-space:normal; min-width:0; max-width:100%; box-sizing:border-box; }
.task-options button { flex:1 1 44%; border:1px solid var(--color-border); background:var(--color-background); }.task-options button[aria-pressed="true"] { border-color:var(--color-primary); background:var(--color-primary-soft,#e7f4eb); color:var(--color-primary); }
.operation-task input,.operation-task textarea { width:100%; box-sizing:border-box; min-height:44px; margin:12rpx 0; padding:16rpx; background:var(--color-background); border:1px solid var(--color-border); border-radius:12rpx; font-size:30rpx; line-height:1.6; }
.task-actions,.task-search { display:flex; flex-wrap:wrap; align-items:center; gap:16rpx; }.task-actions button { flex:1 1 44%; }.task-search input { flex:1 1 55%; min-width:0; }.task-search button { flex:0 0 auto; }.task-error { margin:12rpx 0; color:var(--color-danger,#a52626); font-size:26rpx; }.task-result { display:grid; gap:20rpx; font-size:28rpx; line-height:1.65; }
.operation-task button:focus-visible,.operation-task input:focus-visible,.operation-task textarea:focus-visible { outline:2px solid var(--color-primary); outline-offset:3px; }
@media (max-width:350px) { .task-actions button,.task-options button { flex-basis:100%; } }
</style>
