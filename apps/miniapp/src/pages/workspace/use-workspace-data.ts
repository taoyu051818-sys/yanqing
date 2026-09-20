import { computed, onUnmounted, ref, watch } from 'vue'
import { endpoints, type WorkItem } from '../../services/api'
import { canViewOperatingData } from '../../config/workspace'
import { useSessionStore } from '../../stores/session'
import { money, today } from '../../utils/format'

export function useWorkspaceData() {
  const session = useSessionStore()
  const loading = ref(false), loadError = ref(''), workItems = ref<WorkItem[]>([])
  const dataLoading = ref(false), dataError = ref(''), dashboard = ref<Record<string, any> | null>(null)
  const days = ref(1)
  let workRequest = 0, dataRequest = 0
  const scope = () => `${session.user?.id || ''}:${session.roles.join(',')}`
  function clear() { workRequest++; dataRequest++; workItems.value = []; dashboard.value = null; loading.value = false; dataLoading.value = false; loadError.value = ''; dataError.value = '' }
  watch(scope, clear)
  onUnmounted(clear)
  async function loadWork() {
    await session.hydrate()
    if (!session.isOperator) return
    const request = ++workRequest, actor = scope()
    loading.value = true; loadError.value = ''
    try {
      const result = await endpoints.workItems(100)
      if (request === workRequest && actor === scope()) workItems.value = Array.isArray(result) ? result : []
    } catch {
      if (request === workRequest && actor === scope()) { workItems.value = []; loadError.value = '待办暂未同步，请重试。' }
    } finally { if (request === workRequest) loading.value = false }
  }
  async function loadData() {
    if (!canViewOperatingData(session.roles)) { dashboard.value = null; return }
    const request = ++dataRequest, actor = scope()
    dataLoading.value = true; dataError.value = ''; dashboard.value = null
    const periodStart = new Date(`${today(1 - days.value)}T00:00:00+08:00`).toISOString()
    const periodEnd = new Date(`${today(1)}T00:00:00+08:00`).toISOString()
    try {
      const result = await endpoints.dashboard({ periodStart, periodEnd })
      if (request === dataRequest && actor === scope()) dashboard.value = result
    } catch {
      if (request === dataRequest && actor === scope()) dataError.value = '经营数据加载失败，请重试。'
    } finally { if (request === dataRequest) dataLoading.value = false }
  }
  const periodLabel = computed(() => days.value === 1 ? `${today()} · 北京时间` : `${today(1 - days.value)} 至 ${today()} · 北京时间`)
  const metrics = computed(() => {
    const d = dashboard.value
    const amount = (value: unknown) => d && typeof value === 'number' ? money(value) : '—'
    return [
      { label:'已收金额', value:amount(d?.collections?.grossPaymentCents), note:'含充值与培训预收' },
      { label:'场地使用率', value: typeof d?.venue?.utilizationRate === 'number' ? `${d.venue.utilizationRate}%` : '—', note:'已订场地小时 / 可售小时' },
      { label:'场地预约数', value: typeof d?.venue?.bookingCount === 'number' ? String(d.venue.bookingCount) : '—', note:'所选日期内的场地预约' },
      { label:'已实现收入', value:amount(d?.revenue?.realizedRevenueCents), note:'按履约确认，已扣退款' },
    ]
  })
  return { loading, loadError, workItems, loadWork, dataLoading, dataError, dashboard, days, periodLabel, metrics, loadData }
}
