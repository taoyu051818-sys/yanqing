import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Exercise the actual SFC loader with controllable transport completion order.
function fixture() {
  const source=readFileSync(new URL('./index.vue',import.meta.url),'utf8')
  const loader=source.slice(source.indexOf('let availabilitySequence'),source.indexOf('\nfunction choose('))
  const js=ts.transpileModule(loader,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const date={value:'2026-09-09'},data={value:null as any},loading={value:false},error={value:''},selected={value:null}
  const pending: Record<string,{resolve:(data:unknown)=>void;reject:(cause:Error)=>void}>={}
  const endpoints={availability:(day:string)=>new Promise((resolve,reject)=>{pending[day]={resolve,reject}})}
  const load=new Function('date','data','loading','error','selected','endpoints','assisted',js+';return load')(date,data,loading,error,selected,endpoints,{value:false})
  return {date,data,loading,error,pending,load}
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
