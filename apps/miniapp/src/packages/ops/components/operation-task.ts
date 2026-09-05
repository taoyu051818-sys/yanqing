import { nextTick, onUnmounted, reactive } from 'vue'
import { apiFeedback } from '../../../services/api-feedback'

export type TaskOption = { value: string; label: string; description?: string }
export type TaskField = {
  key: string; label: string; kind?: 'text' | 'money' | 'number' | 'choices' | 'reason' | 'search'
  initial?: string; hint?: string; required?: boolean; min?: number; max?: number
  options?: TaskOption[]
  optionsFor?: (values: Record<string, string>) => TaskOption[]
  search?: (keyword: string, page: number) => Promise<{ items: TaskOption[]; total: number }>
}
export type TaskDefinition = {
  title: string; description: string; confirmText: string; fields: TaskField[]
  submit: (values: Record<string, string>) => Promise<string>
}
export function validateTaskField(field: TaskField, value: string): string {
  if (!value && field.required !== false) return '请填写或选择' + field.label
  if (!value) return ''
  if (field.kind === 'money') {
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(Math.round(Number(value) * 100))) return '请输入有效金额（元，最多两位小数）'
  } else if (field.kind === 'number') {
    const number = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < (field.min ?? 1) || number > (field.max ?? 100000)) return field.label + '超出允许范围'
  } else if (value.length < (field.min ?? 1) || value.length > (field.max ?? 500)) return field.label + '长度不符合要求'
  if (['choices', 'search'].includes(field.kind || '') && !field.options?.some(item => item.value === value)) return '请重新选择' + field.label
  return ''
}
function scrollToTask(selector: string) {
  // #ifdef H5
  const target = document.querySelector(selector)
  if (target) {
    uni.pageScrollTo({ scrollTop: Math.max(0, window.scrollY + target.getBoundingClientRect().top - 64), duration: 200 })
    return
  }
  // #endif
  uni.pageScrollTo({ selector, duration: 200 })
}
export function useOperationTask() {
  const state = reactive({
    open: false, title: '', description: '', confirmText: '', busy: false, error: '', result: '',
    focusKey: '', fields: [] as TaskField[], values: {} as Record<string, string>, errors: {} as Record<string, string>,
    searches: {} as Record<string, { keyword: string; page: number; total: number; loading: boolean; error: string }>,
  })
  let definition: TaskDefinition | undefined
  let generation = 0
  let alive = true
  let actorScope = ''
  const currentActor = () => String(uni.getStorageSync('yanqing_actor_id') || uni.getStorageSync('yanqing_access_token') || '')
  onUnmounted(() => { alive = false; generation++ })
  async function search(key: string, keyword = '', more = false) {
    const field = state.fields.find(item => item.key === key)
    if (!field?.search) return
    const current = generation
    const previous = state.searches[key]
    if (previous?.loading) return
    const page = more ? (previous?.page || 1) + 1 : 1
    const request = { keyword, page, total: previous?.total || 0, loading: true, error: '' }
    state.searches[key] = request
    try {
      const response = await field.search(keyword.trim(), page)
      if (!alive || current !== generation) return
      field.options = more ? [...(field.options || []), ...response.items] : response.items
      state.searches[key].total = response.total
      if (!field.options.some(item => item.value === state.values[key])) state.values[key] = ''
    } catch (cause: any) {
      if (alive && current === generation) state.searches[key].error = apiFeedback(cause?.message, cause?.statusCode || 0)
    } finally { if (alive && current === generation) state.searches[key].loading = false }
  }
  function start(task: TaskDefinition) {
    if (state.busy) return
    // Do not silently discard an unfinished task by tapping another record.
    if (state.open) { void nextTick(() => scrollToTask('#operation-task')); return }
    generation++
    definition = task
    actorScope = currentActor()
    Object.assign(state, { open: true, title: task.title, description: task.description,
      confirmText: task.confirmText, result: '', error: '', focusKey: '', errors: {}, searches: {},
      fields: task.fields.map(field => ({ ...field })), values: Object.fromEntries(task.fields.map(field => [field.key, field.initial || ''])) })
    for (const field of state.fields) if (field.search) void search(field.key)
    void nextTick(() => uni.pageScrollTo({ selector: '#operation-task', duration: 200 }))
  }
  function validate(key: string) {
    const field = state.fields.find(item => item.key === key)
    if (field) state.errors[key] = validateTaskField(field.optionsFor ? { ...field, options: field.optionsFor(state.values) } : field, (state.values[key] || '').trim())
  }
  function focus(key: string) {
    state.focusKey = key
    void nextTick(() => scrollToTask('#task-field-' + key))
  }
  async function submit() {
    if (!definition || state.busy) return
    state.error = ''
    if (actorScope !== currentActor()) { state.error = '登录身份已变化，请关闭此操作并重新选择记录'; return }
    const values = Object.fromEntries(Object.entries(state.values).map(([key, value]) => [key, value.trim()]))
    state.errors = Object.fromEntries(state.fields.map(field => [field.key, validateTaskField(field.optionsFor ? { ...field, options: field.optionsFor(values) } : field, values[field.key] || '')]).filter(([, error]) => error))
    if (Object.keys(state.errors).length) { focus(Object.keys(state.errors)[0]); return }
    if (Object.values(state.searches).some(item => item.loading)) return
    state.busy = true
    try {
      const result = await definition.submit(values)
      if (!alive) return
      state.open = false; state.result = result; definition = undefined
    } catch (cause: any) { if (alive) state.error = apiFeedback(cause?.message, cause?.statusCode || 0) }
    finally { state.busy = false }
  }
  function cancel() { if (!state.busy) { generation++; state.open = false; definition = undefined; state.values = {}; state.searches = {} } }
  return { state, start, submit, cancel, search, validate, focus }
}
export const reasonField = (label = '原因', options: string[] = []): TaskField => ({
  key: 'reason', label, kind: 'reason', min: 2, max: 300,
  options: options.map(value => ({ value, label: value })),
})
