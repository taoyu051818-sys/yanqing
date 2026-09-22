import * as vue from 'vue'
import { loadTaskScript } from '../../test-utils/sfc-script'
import { describe, expect, it } from 'vitest'

// Exercise the complete task, including computed selection, with controlled transport timing.
function fixture() {
  const pending: Record<string,{resolve:(data:unknown)=>void;reject:(cause:Error)=>void}>={}
  const endpoints={availability:(day:string)=>new Promise((resolve,reject)=>{pending[day]={resolve,reject}})}
  const { useBookingAvailability } = loadTaskScript(new URL('./use-booking-availability.ts', import.meta.url), id => {
    if (id === 'vue') return vue
    if (id.endsWith('/services/api')) return { endpoints }
    if (id.endsWith('/utils/format')) return { today: () => '2026-09-09' }
    throw new Error(id)
  })
  const task = useBookingAvailability({ assisted: vue.ref(false), isSubmitting: () => false, onSelectionChange: () => {} })
  return { ...task, pending }
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
