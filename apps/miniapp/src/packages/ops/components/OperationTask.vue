<script setup lang="ts">
import { nextTick, reactive, watch } from 'vue'
import ActionDialog from '../../../components/ActionDialog.vue'
import type { useOperationTask } from './operation-task'
const props = defineProps<{ task: ReturnType<typeof useOperationTask> }>()
const keywords = reactive<Record<string, string>>({})
const customReasons = reactive<Record<string, boolean>>({})
watch(() => props.task.state.open, open => { if (open) { for (const key of Object.keys(keywords)) delete keywords[key]; for (const key of Object.keys(customReasons)) delete customReasons[key] } })
function validateEdited(key: string) {
  if (props.task.state.errors[key]) void nextTick(() => props.task.validate(key))
}
function select(key: string, value: string) {
  props.task.state.values[key] = value
  delete props.task.state.errors[key]
}
</script>

<template>
  <ActionDialog v-if="task.state.open || task.state.result" :title="task.state.open ? task.state.title : '处理完成'" :busy="task.state.busy" :scroll-into-view="task.state.scrollTarget" @close="task.cancel">
    <view class="operation-task">
    <view v-if="!task.state.open" role="status" class="task-result">
      <text>{{ task.state.result }}</text>
    </view>
    <template v-else>
      <text class="task-description">{{ task.state.description }}</text>
      <view v-for="field in task.state.fields" :key="field.key" :id="'task-field-' + field.key" class="task-field">
        <text :id="'task-label-' + field.key" class="task-label">{{ field.label }}{{ field.required === false ? '（选填）' : '（必填）' }}</text>
        <text v-if="field.hint" class="task-hint">{{ field.hint }}</text>
        <view v-if="field.kind === 'search'" class="task-search">
          <input v-model="keywords[field.key]" :aria-label="'搜索' + field.label" :disabled="task.state.busy" placeholder="输入姓名搜索" maxlength="50" confirm-type="search" :adjust-position="false" @confirm="task.search(field.key, keywords[field.key])" />
          <button :disabled="task.state.busy || task.state.searches[field.key]?.loading" @tap="task.search(field.key, keywords[field.key])">搜索</button>
        </view>
        <view v-if="['choices','search','reason'].includes(field.kind || '')" class="task-options">
          <button v-for="option in (field.optionsFor ? field.optionsFor(task.state.values) : field.options)" :key="option.value" :class="{ selected: task.state.values[field.key] === option.value }" :aria-pressed="task.state.values[field.key] === option.value" :disabled="task.state.busy" @tap="customReasons[field.key] = false; select(field.key, option.value)">
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
        <textarea v-if="!['choices','search','number','money'].includes(field.kind || '') && (field.kind !== 'reason' || customReasons[field.key] || !field.options?.length)" v-model="task.state.values[field.key]" :focus="task.state.focusKey === field.key" @input="validateEdited(field.key)" @blur="task.validate(field.key)" :aria-labelledby="'task-label-' + field.key" :aria-describedby="'task-error-' + field.key" :disabled="task.state.busy" :maxlength="field.max || 500" :adjust-position="false" auto-height />
        <input v-if="field.kind === 'number' || field.kind === 'money'" v-model="task.state.values[field.key]" :focus="task.state.focusKey === field.key" @input="validateEdited(field.key)" @blur="task.validate(field.key)" :type="field.kind === 'money' ? 'digit' : 'number'" :aria-labelledby="'task-label-' + field.key" :aria-describedby="'task-error-' + field.key" :disabled="task.state.busy" maxlength="12" :adjust-position="false" />
        <text v-if="task.state.errors[field.key]" :id="'task-error-' + field.key" class="task-error field-error" aria-live="polite">{{ task.state.errors[field.key] }}</text>
      </view>
      <text v-if="task.state.error" class="task-error" role="alert">{{ task.state.error }}。内容已保留，可修改后重试。</text>
    </template>
    </view>
    <template #footer>
      <view v-if="task.state.open" class="task-actions">
        <button class="secondary" :disabled="task.state.busy" @tap="task.cancel">暂不处理</button>
        <button class="primary" :loading="task.state.busy" :disabled="task.state.busy || Object.values(task.state.searches).some(item => item.loading)" @tap="task.submit">{{ task.state.busy ? '正在提交…' : task.state.confirmText }}</button>
      </view>
      <button v-else class="primary result-close" @tap="task.cancel">知道了，继续处理</button>
    </template>
  </ActionDialog>
</template>

<style scoped>
.operation-task { color:var(--color-foreground,#18221c); overflow-wrap:anywhere; }
.task-description,.task-label,.task-hint,.task-error { display:block; line-height:1.65; }
.task-description { margin:0 0 24rpx; color:var(--color-muted,#5f6f65); font-size:26rpx; }
.task-label { font-weight:700; font-size:28rpx; }
.task-hint { margin-top:8rpx; color:var(--color-muted,#5f6f65); font-size:24rpx; }
.task-field { margin:24rpx 0 0; min-width:0; }
.task-options { display:flex; flex-wrap:wrap; gap:16rpx; margin-top:16rpx; }
.operation-task button,.task-actions button,.result-close { display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:44px; height:auto; margin:0; padding:18rpx 20rpx; border-radius:var(--radius-sm,16rpx); font-size:27rpx; line-height:1.5; white-space:normal; min-width:0; max-width:100%; box-sizing:border-box; }
.task-options button { flex:1 1 44%; color:var(--color-muted,#5f6f65); border:1rpx solid var(--color-border); background:var(--color-surface-subtle,#f7f9f6); }
.task-options button.selected { border-color:var(--color-primary,#17653d); background:var(--color-primary-soft,#e7f4eb); color:var(--color-primary-strong,#123f29); }
.operation-task input,.operation-task textarea { width:100%; box-sizing:border-box; min-height:44px; margin:14rpx 0 0; padding:20rpx 22rpx; background:var(--color-surface-subtle,#f7f9f6); color:var(--color-foreground,#18221c); border:1rpx solid var(--color-border); border-radius:18rpx; font-size:28rpx; line-height:1.6; }
.operation-task textarea { min-height:128rpx; }
.task-actions,.task-search { display:flex; flex-wrap:wrap; align-items:center; gap:16rpx; }
.task-actions button { flex:1 1 40%; min-height:48px; border-radius:22rpx; font-size:28rpx; }
.task-actions .primary { flex-grow:1.2; }
.result-close { width:100%; min-height:48px; border-radius:22rpx; font-size:28rpx; }
.task-search { margin-top:14rpx; }.task-search input { flex:1 1 55%; min-width:0; margin:0; }.task-search button { flex:0 0 auto; color:var(--color-primary); background:var(--color-primary-soft); }
.task-error { margin:14rpx 0 0; color:var(--color-danger,#a52626); font-size:25rpx; }
.task-result { font-size:28rpx; line-height:1.75; color:var(--color-primary-strong,#123f29); }
.operation-task button:focus-visible,.operation-task input:focus-visible,.operation-task textarea:focus-visible { outline:2px solid var(--color-accent,#b68b22); outline-offset:2px; }
@media (max-width:350px) { .task-actions button,.task-options button { flex-basis:100%; } }
</style>
