'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowRight, Check, Compass, Info, Lightbulb, X } from 'lucide-react'
import { FLOWS, flowByKey } from '@/lib/flows'
import type { FlowKey } from '@/lib/types'
import { useDemoStore } from '@/lib/store'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface GuideIntro {
  title: string
  desc: string
  rules?: string[]
}

interface GuideNote {
  id: string
  title: string
  body: React.ReactNode
}

interface GuideContextValue {
  intro: GuideIntro | null
  notes: GuideNote[]
  flowKeys: FlowKey[]
  setIntro: (intro: GuideIntro | null) => void
  upsertNote: (note: GuideNote) => void
  removeNote: (id: string) => void
  addFlow: (key: FlowKey) => void
  removeFlow: (key: FlowKey) => void
  openGuide: () => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

function useGuideContext() {
  return useContext(GuideContext)
}

/** 页面注册说明文案，由悬浮指引统一呈现，页面内不再渲染 */
export function useRegisterIntro(intro: GuideIntro) {
  const ctx = useGuideContext()
  const latest = useRef(intro)
  latest.current = intro
  const signature = `${intro.title}||${intro.desc}||${intro.rules?.join('~') ?? ''}`
  const setIntro = ctx?.setIntro

  useEffect(() => {
    if (!setIntro) return
    setIntro(latest.current)
    return () => setIntro(null)
  }, [signature, setIntro])
}

/** 页面注册业务口径说明，收进悬浮指引 */
export function useRegisterNote(title: string, body: React.ReactNode) {
  const ctx = useGuideContext()
  const id = useId()
  const latest = useRef(body)
  latest.current = body
  const upsertNote = ctx?.upsertNote
  const removeNote = ctx?.removeNote

  useEffect(() => {
    if (!upsertNote || !removeNote) return
    upsertNote({ id, title, body: latest.current })
    return () => removeNote(id)
  }, [id, title, upsertNote, removeNote])
}

/** 页面声明所属闭环，指引面板据此展示步骤进度 */
export function useRegisterFlow(key: FlowKey) {
  const ctx = useGuideContext()
  const addFlow = ctx?.addFlow
  const removeFlow = ctx?.removeFlow

  useEffect(() => {
    if (!addFlow || !removeFlow) return
    addFlow(key)
    return () => removeFlow(key)
  }, [key, addFlow, removeFlow])
}

/** 闭环步骤清单 */
function FlowSteps({ flowKey, onNavigate }: { flowKey: FlowKey; onNavigate: () => void }) {
  const flow = flowByKey(flowKey)
  const steps = useDemoStore((s) => s.flows[flowKey].steps)
  const done = flow.steps.filter((s) => steps[s.key]).length
  const pct = Math.round((done / flow.steps.length) * 100)
  const nextIndex = flow.steps.findIndex((s) => !steps[s.key])

  return (
    <section className="flex flex-col gap-2.5 rounded-xl bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-foreground">
          闭环{flow.index} · {flow.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {done}/{flow.steps.length}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-col">
        {flow.steps.map((s, i) => {
          const ok = steps[s.key]
          const isNext = i === nextIndex
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-1.5 py-2 active:bg-secondary/60',
                  isNext && 'bg-brand/10',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px]',
                    ok ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {ok ? <Check className="size-2.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[11px]',
                    ok ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {s.label}
                </span>
                {isNext && (
                  <span className="shrink-0 rounded bg-brand px-1.5 py-0.5 text-[9px] font-semibold text-brand-foreground">
                    下一步
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** 悬浮指引面板 */
function GuideSheet({
  open,
  onOpenChange,
  intro,
  notes,
  flowKeys,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  intro: GuideIntro | null
  notes: GuideNote[]
  flowKeys: FlowKey[]
}) {
  const close = () => onOpenChange(false)
  const otherFlows = FLOWS.filter((f) => !flowKeys.includes(f.key))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[86svh] rounded-t-2xl bg-muted p-0">
        <SheetHeader className="px-4 pb-1 pt-4">
          <SheetTitle className="flex items-center gap-1.5 text-sm">
            <Compass className="size-4 text-brand-foreground" />
            演示指引
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-3 pb-8 pt-2">
          {intro && (
            <section className="flex flex-col gap-2 rounded-xl bg-card px-3 py-3">
              <div className="flex items-center gap-1.5">
                <Info className="size-3.5 shrink-0 text-primary" />
                <span className="truncate text-[13px] font-semibold text-foreground">{intro.title}</span>
              </div>
              <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">{intro.desc}</p>
              {intro.rules && intro.rules.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {intro.rules.map((r) => (
                    <span
                      key={r}
                      className="rounded-md bg-secondary px-1.5 py-1 text-[10px] leading-none text-secondary-foreground"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {flowKeys.map((k) => (
            <FlowSteps key={k} flowKey={k} onNavigate={close} />
          ))}

          {notes.map((n) => (
            <section key={n.id} className="flex flex-col gap-1 rounded-xl bg-gold/12 px-3 py-3">
              <div className="flex items-center gap-1.5">
                <Lightbulb className="size-3.5 shrink-0 text-gold-foreground" />
                <span className="text-[11px] font-semibold text-gold-foreground">{n.title}</span>
              </div>
              <p className="text-pretty text-[11px] leading-relaxed text-foreground/75">{n.body}</p>
            </section>
          ))}

          {otherFlows.length > 0 && (
            <section className="overflow-hidden rounded-xl bg-card">
              <div className="px-3 pb-1 pt-3 text-[11px] font-medium text-muted-foreground">跳转其他闭环</div>
              {otherFlows.map((f) => (
                <Link
                  key={f.key}
                  href={f.entry}
                  onClick={close}
                  className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5 last:border-0 active:bg-secondary/60"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[10px] text-muted-foreground">
                    {f.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{f.title}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                </Link>
              ))}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** 步骤完成后自动弹出的引导气泡 */
function StepToast({
  tip,
  onClose,
  onOpenGuide,
}: {
  tip: { doneLabel: string; nextLabel?: string; nextHref?: string }
  onClose: () => void
  onOpenGuide: () => void
}) {
  return (
    <div className="pointer-events-auto flex flex-col gap-2 rounded-2xl bg-sidebar px-3 py-3 text-sidebar-foreground shadow-lg shadow-foreground/25">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
          <Check className="size-2.5" />
        </span>
        <p className="min-w-0 flex-1 text-pretty text-[11px] leading-relaxed">
          已完成 <span className="font-semibold">{tip.doneLabel}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭引导"
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-sidebar-foreground/60 active:bg-sidebar-accent"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {tip.nextLabel && tip.nextHref ? (
        <Link
          href={tip.nextHref}
          onClick={onClose}
          className="flex items-center gap-2 rounded-xl bg-sidebar-accent px-2.5 py-2 active:bg-sidebar-accent/70"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] uppercase tracking-wide text-sidebar-foreground/60">下一步</span>
            <span className="block truncate text-[11px] font-medium">{tip.nextLabel}</span>
          </span>
          <ArrowRight className="size-3.5 shrink-0" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => {
            onClose()
            onOpenGuide()
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-sidebar-accent px-2.5 py-2 text-[11px] font-medium active:bg-sidebar-accent/70"
        >
          本闭环已跑通，查看全部指引
          <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** 悬浮指引：右下角气泡按钮 + 底部面板 + 步骤完成��示 */
export function GuideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [intro, setIntroState] = useState<GuideIntro | null>(null)
  const [notes, setNotes] = useState<GuideNote[]>([])
  const [flowKeys, setFlowKeys] = useState<FlowKey[]>([])
  const [tip, setTip] = useState<{ doneLabel: string; nextLabel?: string; nextHref?: string } | null>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const onMode = (event: Event) => setVisible((event as CustomEvent).detail !== 'customer')
    window.addEventListener('demo-guide-mode', onMode)
    return () => window.removeEventListener('demo-guide-mode', onMode)
  }, [])

  const setIntro = useCallback((v: GuideIntro | null) => setIntroState(v), [])
  const upsertNote = useCallback((n: GuideNote) => {
    setNotes((prev) => (prev.some((p) => p.id === n.id) ? prev.map((p) => (p.id === n.id ? n : p)) : [...prev, n]))
  }, [])
  const removeNote = useCallback((id: string) => setNotes((prev) => prev.filter((p) => p.id !== id)), [])
  const addFlow = useCallback(
    (k: FlowKey) => setFlowKeys((prev) => (prev.includes(k) ? prev : [...prev, k])),
    [],
  )
  const removeFlow = useCallback((k: FlowKey) => setFlowKeys((prev) => prev.filter((p) => p !== k)), [])
  const openGuide = useCallback(() => setOpen(true), [])

  /** 监听闭环步骤变化，完成一步就弹出下一步引导 */
  const flows = useDemoStore((s) => s.flows)
  const prevRef = useRef<Record<string, boolean> | null>(null)
  /** 本地存储回填会造成一次批量变化，需跳过以免刷新页面就弹旧提示 */
  const mountedAt = useRef(0)
  useEffect(() => {
    mountedAt.current = Date.now()
  }, [])

  useEffect(() => {
    const flat: Record<string, boolean> = {}
    for (const f of FLOWS) {
      for (const s of f.steps) flat[`${f.key}.${s.key}`] = Boolean(flows[f.key].steps[s.key])
    }

    const prev = prevRef.current
    prevRef.current = flat
    if (!prev) return
    if (mountedAt.current === 0 || Date.now() - mountedAt.current < 1200) return

    // 一次操作可能推进多步，取流程中最靠后的那一步作为提示主体
    const changed = Object.keys(flat).filter((k) => flat[k] && !prev[k])
    if (changed.length === 0) return

    const [flowKey] = changed[changed.length - 1].split('.') as [FlowKey, string]
    const flow = flowByKey(flowKey)
    const doneStep = [...flow.steps]
      .reverse()
      .find((s) => changed.includes(`${flowKey}.${s.key}`))
    const next = flow.steps.find((s) => !flat[`${flowKey}.${s.key}`])
    if (!doneStep) return

    setTip({ doneLabel: doneStep.label, nextLabel: next?.label, nextHref: next?.href })
  }, [flows])

  /** 引导气泡自动收起 */
  useEffect(() => {
    if (!tip) return
    const timer = setTimeout(() => setTip(null), 9000)
    return () => clearTimeout(timer)
  }, [tip])

  /** 切换页面时收起气泡与面板 */
  useEffect(() => {
    setTip(null)
    setOpen(false)
  }, [pathname])

  const activeFlow = flowKeys[0]
  const progress = useMemo(() => {
    if (!activeFlow) return null
    const flow = flowByKey(activeFlow)
    const done = flow.steps.filter((s) => flows[activeFlow].steps[s.key]).length
    return { done, total: flow.steps.length }
  }, [activeFlow, flows])

  const value = useMemo<GuideContextValue>(
    () => ({ intro, notes, flowKeys, setIntro, upsertNote, removeNote, addFlow, removeFlow, openGuide }),
    [intro, notes, flowKeys, setIntro, upsertNote, removeNote, addFlow, removeFlow, openGuide],
  )

  const hasContent = Boolean(intro) || notes.length > 0 || flowKeys.length > 0

  return (
    <GuideContext.Provider value={value}>
      {children}

      {hasContent && visible && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[430px] flex-col items-end gap-2 px-3 pb-[calc(58px+env(safe-area-inset-bottom))]">
          {tip && <StepToast tip={tip} onClose={() => setTip(null)} onOpenGuide={openGuide} />}

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-primary py-2 pl-2.5 pr-3 text-primary-foreground shadow-lg shadow-primary/25 active:bg-primary/90"
          >
            <Compass className="size-4" />
            <span className="text-[11px] font-semibold leading-none">指引</span>
            {progress && (
              <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px] leading-none">
                {progress.done}/{progress.total}
              </span>
            )}
          </button>
        </div>
      )}

      <GuideSheet open={open} onOpenChange={setOpen} intro={intro} notes={notes} flowKeys={flowKeys} />
    </GuideContext.Provider>
  )
}
