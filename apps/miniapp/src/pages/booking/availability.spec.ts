import * as vue from 'vue'
import { loadTaskScript } from '../../test-utils/sfc-script'
import { describe, expect, it } from 'vitest'

// Exercise the complete task, including computed selection, with controlled transport timing.
function fixture() {
  const pending: Record<string,{resolve:(data:unknown)=>void;reject:(cause:Error)=>void}>={}
  const endpoints: any={availability:(day:string)=>new Promise((resolve,reject)=>{pending[day]={resolve,reject}})}
  const { useBookingAvailability } = loadTaskScript(new URL('./use-booking-availability.ts', import.meta.url), id => {
    if (id === 'vue') return vue
    if (id.endsWith('/services/api')) return { endpoints }
    if (id.endsWith('/utils/format')) return { today: () => '2026-09-09' }
    throw new Error(id)
  })
  endpoints.assistedAvailability = endpoints.availability
  const assisted = vue.ref(false)
  const task = useBookingAvailability({ assisted, isSubmitting: () => false, onSelectionChange: () => {} })
  return { ...task, pending, assisted }
}
describe('booking date query ownership',()=>{
  it('ignores an old success arriving after the selected date response',async()=>{
    const f=fixture();const a=f.load(true);f.date.value='2026-09-10';const b=f.load(true)
    f.pending['2026-09-10'].resolve({date:'2026-09-10'});await b
    f.pending['2026-09-09'].resolve({date:'2026-09-09'});await a
    expect(f.data.value.date).toBe(f.date.value)
    expect(f.loading.value).toBe(false)
  })
  it('does not unlock checkout or show an obsolete error while the newest request is pending',async()=>{
    const f=fixture();const a=f.load(true);f.date.value='2026-09-10';const b=f.load(true)
    f.pending['2026-09-09'].reject(new Error('old request failed'));await a
    expect(f.loading.value).toBe(true);expect(f.error.value).toBe('')
    f.pending['2026-09-10'].resolve({date:'2026-09-10'});await b
    expect(f.data.value.date).toBe(f.date.value)
  })
})

it('clears the previous grid when a new date fails, and restores only the retried date', async () => {
  const f = fixture(); const old = f.load();
  f.pending[f.date.value].resolve({date:f.date.value, slots:[], courts:[]}); await old;
  f.date.value = '2026-09-10';
  expect(f.data.value).toBeNull();
  const next = f.load(); f.pending[f.date.value].reject(new Error('断网')); await next;
  expect(f.visibleSlots.value).toEqual([]);
  f.choose('court', {id:'slot', price:{priceCents:100}});
  expect(f.selected.value).toBeNull();
  expect(f.error.value).toBe('断网');
  const retry = f.load(); f.pending[f.date.value].resolve({date:f.date.value, slots:[], courts:[]}); await retry;
  expect(f.data.value.date).toBe('2026-09-10'); expect(f.error.value).toBe('');
});
it('discards an assisted response after switching to self booking', async () => {
  const f = fixture(); f.assisted.value = true; const old = f.load();
  f.assisted.value = false;
  f.pending[f.date.value].resolve({date:f.date.value}); await old;
  expect(f.data.value).toBeNull(); expect(f.loading.value).toBe(false);
});
