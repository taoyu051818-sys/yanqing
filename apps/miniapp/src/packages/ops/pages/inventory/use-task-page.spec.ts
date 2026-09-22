import { computed, ref } from 'vue';
import { beforeEach, expect, it, vi } from 'vitest';
import { useInventoryTaskPage } from './use-task-page';
import { parseInventoryTask, type InventoryTask } from './task-route';
import type { Tab } from './page-types';
vi.mock('../../composables/use-unsaved-form', () => ({ useUnsavedForm: (snapshot: () => unknown, enabled: () => boolean) => {
 const baseline = ref(JSON.stringify(snapshot()));
 return { dirty:computed(() => enabled() && JSON.stringify(snapshot()) !== baseline.value), markSaved:() => { baseline.value=JSON.stringify(snapshot()); } };
} }));
beforeEach(() => { vi.stubGlobal('getCurrentPages', () => [{},{}]); vi.stubGlobal('uni', { navigateBack:vi.fn(), redirectTo:vi.fn(), showModal:vi.fn(async () => ({confirm:false})) }); });
function setup(admin=true) {
 const data=ref({quantity:''}), visible=ref(false), isAdmin=ref(admin);
 const submit=vi.fn(async () => {}), open=vi.fn(() => { visible.value=true; });
 const form={snapshot:()=>data.value, open, submit, visible};
 const forms=Object.fromEntries(['master','purchase','stocktake','movement','usage'].map(key=>[key,form])) as Record<InventoryTask,typeof form>;
 const page=useInventoryTaskPage({route:ref(parseInventoryTask({form:'purchase'})), tab:ref<Tab>('PURCHASE'), saving:ref(false), loading:ref(false), loadError:ref(''), isAdmin, load:async()=>{}, forms});
 return {...page, data, visible, isAdmin, open, submit};
}
it('blocks direct task links for read-only staff',async()=>{
 const p=setup(false); await p.loadPage(); await p.submitTask();
 expect(p.open).not.toHaveBeenCalled(); expect(p.submit).not.toHaveBeenCalled(); expect(p.taskReady.value).toBe(false); expect(p.taskError.value).toContain('只能查看');
});
it('retains the draft on reload and failed save, and returns only after a successful command',async()=>{
 const p=setup(); await p.loadPage(); p.data.value.quantity='7'; await p.loadPage();
 expect(p.open).toHaveBeenCalledTimes(1); expect(p.data.value.quantity).toBe('7');
 p.submit.mockRejectedValueOnce(new Error('network failed')); await p.submitTask();
 expect(p.taskError.value).toBe('network failed'); expect(uni.navigateBack).not.toHaveBeenCalled();
 p.submit.mockImplementationOnce(async()=>{p.visible.value=false;}); await p.submitTask(); expect(uni.navigateBack).toHaveBeenCalledTimes(1);
});
it('lets the user continue editing after cancelling a discard prompt',async()=>{
 const p=setup(); await p.loadPage(); p.data.value.quantity='3'; await p.cancelTask();
 expect(uni.showModal).toHaveBeenCalledOnce(); expect(uni.navigateBack).not.toHaveBeenCalled(); expect(p.data.value.quantity).toBe('3');
 vi.mocked(uni.showModal).mockResolvedValueOnce({confirm:true} as never); await p.cancelTask(); expect(uni.navigateBack).toHaveBeenCalledOnce();
});
it('does not create a blank replacement when initialization cannot find the requested record',async()=>{
 const p=setup(); p.open.mockImplementationOnce(()=>{throw new Error('资料已不存在');}); await p.loadPage(); await p.submitTask();
 expect(p.taskReady.value).toBe(false); expect(p.taskError.value).toBe('资料已不存在'); expect(p.submit).not.toHaveBeenCalled();
});

it('returns to its business list after a save from a direct link',async()=>{
 vi.stubGlobal('getCurrentPages',()=>[{}]); const p=setup(); await p.loadPage();
 p.submit.mockImplementationOnce(async()=>{p.visible.value=false;}); await p.submitTask();
 expect(uni.navigateBack).not.toHaveBeenCalled(); expect(uni.redirectTo).toHaveBeenCalledWith({url:'/packages/ops/pages/inventory/index?view=PURCHASE'});
});
