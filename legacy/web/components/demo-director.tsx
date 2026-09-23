'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Eye, Pause, Play, Presentation, RotateCcw, X } from 'lucide-react'
import { DEMO_SCRIPTS, type ScriptMode } from '@/lib/scripts'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function DemoDirector() {
  const pathname = usePathname()
  const [open,setOpen]=useState(false)
  const [mode,setMode]=useState<'presenter'|'customer'>('presenter')
  const [scriptId,setScriptId]=useState<ScriptMode>('quick')
  const [step,setStep]=useState(0)
  const [running,setRunning]=useState(false)
  const script=DEMO_SCRIPTS.find(s=>s.id===scriptId)!
  const current=script.steps[step]

  useEffect(()=>{ window.dispatchEvent(new CustomEvent('demo-guide-mode',{detail:mode})) },[mode])
  useEffect(()=>{
    if(!running || !current || pathname!==current.href) return
    const timer=setTimeout(()=>{
      const el=document.querySelector(`[data-guide="${current.target}"]`) as HTMLElement|null
      if(!el) return
      el.scrollIntoView({behavior:'smooth',block:'center'})
      el.dataset.guideActive='true'
      return ()=>delete el.dataset.guideActive
    },450)
    return ()=>clearTimeout(timer)
  },[running,current,pathname])

  const complete=useMemo(()=>script.steps.filter((_,i)=>i<step).length,[script,step])
  if(mode==='customer') return <button type="button" onClick={()=>setMode('presenter')} className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] right-[max(12px,calc((100vw-430px)/2+12px))] z-50 flex size-9 items-center justify-center rounded-full bg-card text-muted-foreground shadow-md" aria-label="开启讲解员模式"><Eye className="size-4"/></button>

  return <>
    {running&&current&&<div className="pointer-events-none fixed inset-x-0 top-14 z-40 mx-auto w-full max-w-[430px] px-3"><div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-sidebar px-3 py-2.5 text-sidebar-foreground shadow-xl"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sidebar-primary font-mono text-[10px]">{step+1}</span><button className="min-w-0 flex-1 text-left" onClick={()=>setOpen(true)}><span className="block text-[9px] text-sidebar-foreground/60">{current.role} · 正在讲解</span><span className="block truncate text-xs font-medium">{current.title}</span></button><button onClick={()=>setRunning(false)} aria-label="暂停剧本" className="rounded-lg p-2"><Pause className="size-4"/></button></div></div>}
    <button type="button" onClick={()=>setOpen(true)} className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] left-[max(12px,calc((100vw-430px)/2+12px))] z-40 flex items-center gap-1.5 rounded-full bg-sidebar px-3 py-2 text-sidebar-foreground shadow-lg" aria-label="打开演示导演"><Presentation className="size-4"/><span className="text-[11px] font-semibold">演示</span>{running&&<span className="size-1.5 rounded-full bg-brand"/>}</button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="max-h-[88svh] rounded-t-2xl bg-muted p-0"><SheetHeader className="px-4 pb-2 pt-4"><SheetTitle className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Presentation className="size-4 text-primary"/>演示导演台</span><button onClick={()=>setOpen(false)} aria-label="关闭"><X className="size-4"/></button></SheetTitle></SheetHeader><div className="flex flex-col gap-3 overflow-y-auto px-3 pb-8">
      <div className="flex rounded-xl bg-card p-1"><button onClick={()=>setMode('presenter')} className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">讲解员模式</button><button onClick={()=>setMode('customer')} className="flex-1 rounded-lg px-3 py-2 text-xs text-muted-foreground">客户体验模式</button></div>
      <section className="flex flex-col gap-2"><p className="px-1 text-[11px] font-medium text-muted-foreground">选择预置剧本</p>{DEMO_SCRIPTS.map(s=><button key={s.id} onClick={()=>{setScriptId(s.id);setStep(0);setRunning(false)}} className={cn('flex items-center gap-3 rounded-xl bg-card p-3 text-left',scriptId===s.id&&'ring-2 ring-primary')}><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{s.name}</span><span className="rounded bg-secondary px-1.5 py-0.5 text-[9px]">{s.duration}</span></div><p className="mt-0.5 text-[11px] text-muted-foreground">{s.desc}</p></div>{scriptId===s.id&&<Check className="size-4 text-primary"/>}</button>)}</section>
      <section className="rounded-xl bg-card p-3"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold">{script.name}</p><p className="text-[10px] text-muted-foreground">进度 {complete}/{script.steps.length}</p></div><Button size="sm" variant="ghost" onClick={()=>{setStep(0);setRunning(false)}}><RotateCcw className="size-3.5"/>重开</Button></div><div className="flex flex-col">{script.steps.map((s,i)=><Link key={s.id} href={s.href} onClick={()=>{setStep(i);setRunning(true);setOpen(false)}} className={cn('flex items-center gap-2 border-t border-border py-2.5 first:border-0',i===step&&'text-primary')}><span className={cn('flex size-5 items-center justify-center rounded-full bg-secondary font-mono text-[9px]',i<step&&'bg-brand text-brand-foreground',i===step&&'bg-primary text-primary-foreground')}>{i<step?<Check className="size-3"/>:i+1}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{s.title}</span><span className="block truncate text-[10px] text-muted-foreground">{s.talk}</span></span><ChevronRight className="size-3.5 text-muted-foreground"/></Link>)}</div></section>
      <div className="flex gap-2"><Link href={current.href} onClick={()=>{setRunning(true);setOpen(false)}} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Play className="size-4"/>{running?'继续当前步骤':'开始演示'}</Link>{running&&<Button variant="secondary" onClick={()=>setStep(Math.min(step+1,script.steps.length-1))}>下一步</Button>}</div>
    </div></SheetContent></Sheet>
  </>
}
