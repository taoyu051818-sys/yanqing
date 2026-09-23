import { computed, nextTick, ref, type Ref } from 'vue';
import { useUnsavedForm } from '../../composables/use-unsaved-form';
import { taskTabs, type InventoryTask, type InventoryTaskRoute } from './task-route';
import type { Tab } from './page-types';
interface TaskForm {
  snapshot: () => unknown;
  open: (route: InventoryTaskRoute) => void;
  submit: () => Promise<unknown>;
  visible: Ref<boolean>;
}
interface Options {
  route: Ref<InventoryTaskRoute | null>; tab: Ref<Tab>; saving: Ref<boolean>; loading: Ref<boolean>;
  loadError: Ref<string>; isAdmin: Readonly<Ref<boolean>>; load: () => Promise<void>;
  forms: Record<InventoryTask, TaskForm>;
}
/** Owns only task-page navigation and draft lifetime; business commands remain in domain actions. */
export function useInventoryTaskPage(options: Options) {
  const { route, tab, saving, loading, loadError, isAdmin, load, forms } = options;
  const taskReady = ref(false), taskError = ref('');
  const activeForm = computed(() => route.value ? forms[route.value.form] : null);
  const taskTitle = computed(() => {
    const value = route.value;
    if (!value) return '库存作业中心';
    if (value.form === 'master') return `${value.source ? '编辑' : '新增'}${({ ITEM:'商品', SUPPLIER:'供应商', LOCATION:'库位' })[value.masterType]}`;
    return ({ purchase:'新建采购单', stocktake:'新建盘点单', movement:value.movementType === 'LOSS' ? '新建报损单' : '新建调拨单', usage:value.usageType === 'EVENT_USAGE' ? '赛事领用' : '培训领用' })[value.form];
  });
  const { dirty, markSaved } = useUnsavedForm(() => activeForm.value?.snapshot(), () => taskReady.value);
  function returnToList() {
    markSaved();
    const fallback = () => uni.redirectTo({ url: `/packages/ops/pages/inventory/index?view=${tab.value}` });
    if (getCurrentPages().length < 2) fallback();
    else uni.navigateBack({ fail: fallback });
  }
  async function cancelTask() {
    if (saving.value) return;
    if (dirty.value && !(await uni.showModal({ title:'放弃本次填写？', content:'尚未保存的内容会丢失。', confirmText:'放弃填写', cancelText:'继续填写' })).confirm) return;
    returnToList();
  }
  async function submitTask() {
    if (saving.value || loading.value || !taskReady.value || !isAdmin.value || !activeForm.value) return;
    taskError.value = '';
    const form = activeForm.value;
    try {
      await form.submit();
      if (!form.visible.value) returnToList();
    } catch (cause) { taskError.value = cause instanceof Error ? cause.message : '保存失败，请重试'; }
  }
  async function loadPage() {
    await load();
    if (!route.value || loadError.value) return;
    if (!isAdmin.value) { taskReady.value = false; taskError.value = '当前身份只能查看库存预警，无法创建作业。'; return; }
    if (taskReady.value) return;
    tab.value = taskTabs[route.value.form];
    taskError.value = '';
    try {
      activeForm.value!.open(route.value);
      taskReady.value = true;
      await nextTick();
      markSaved();
    } catch (cause) { taskError.value = cause instanceof Error ? cause.message : '作业资料加载失败'; }
  }
  return { taskReady, taskError, taskTitle, returnToList, cancelTask, submitTask, loadPage };
}
