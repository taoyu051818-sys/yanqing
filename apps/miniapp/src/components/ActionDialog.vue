<script setup lang="ts">
import { getCurrentInstance, nextTick, onMounted, onUnmounted, onUpdated, ref } from 'vue'
const props = withDefaults(defineProps<{ title: string; busy?: boolean; scrollIntoView?: string }>(), { busy: false, scrollIntoView: '' })
const emit = defineEmits<{ close: [] }>()
const instance = getCurrentInstance()
const dialogId = 'action-dialog-' + instance?.uid
const bodyHeight = ref('48vh')
const keyboardHeight = ref(0)
let alive = true, measuring = false
function close() { if (!props.busy) emit('close') }
function measure() {
  if (!alive || measuring) return
  measuring = true
  void nextTick(() => {
    if (!alive) { measuring = false; return }
    // #ifdef H5
    prepareButtons()
    // #endif
    const query = uni.createSelectorQuery().in(instance?.proxy)
    for (const selector of ['.dialog-content', '.dialog-header', '.dialog-footer']) query.select(selector).boundingClientRect()
    query.exec((rows: any[]) => {
      measuring = false
      if (!alive || !rows?.[0]) return
      const info = uni.getSystemInfoSync()
      const available = info.windowHeight - keyboardHeight.value - 48 - (info.safeAreaInsets?.top || 0) - (info.safeAreaInsets?.bottom || 0)
      const limit = Math.max(80, available - (rows[1]?.height || 0) - (rows[2]?.height || 0))
      const height = Math.ceil(Math.min(rows[0].height, limit)) + 'px'
      if (bodyHeight.value !== height) bodyHeight.value = height
    })
  })
}
function keyboardChanged(event: { height: number }) { keyboardHeight.value = event.height; measure() }
// #ifdef H5
let previousFocus: HTMLElement | null = null, bodyOverflow = '', rootOverflow = ''
function prepareButtons() {
  for (const button of Array.from(document.getElementById(dialogId)?.querySelectorAll<HTMLElement>('uni-button') || [])) {
    const disabled = button.hasAttribute('disabled') || button.classList.contains('uni-button-disabled')
    button.setAttribute('role', 'button'); button.setAttribute('aria-disabled', String(disabled)); button.tabIndex = disabled ? -1 : 0
  }
}
function keydown(event: KeyboardEvent) {
  const dialog = document.getElementById(dialogId)
  if (!dialog) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  const target = event.target as HTMLElement
  if (['Enter', ' '].includes(event.key) && target.tagName === 'UNI-BUTTON' && dialog.contains(target)) {
    event.preventDefault()
    if (target.getAttribute('aria-disabled') !== 'true') target.click()
    return
  }
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex]')).filter(el => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getClientRects().length)
  const first = controls[0], last = controls[controls.length - 1]
  if (!first) { event.preventDefault(); dialog.focus(); return }
  if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus() }
}
// #endif
onMounted(() => {
  measure()
  // #ifndef H5
  uni.onKeyboardHeightChange?.(keyboardChanged)
  // #endif
  // #ifdef H5
  previousFocus = document.activeElement as HTMLElement
  bodyOverflow = document.body.style.overflow; rootOverflow = document.documentElement.style.overflow
  document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'
  document.addEventListener('keydown', keydown, true)
  window.addEventListener('resize', measure)
  void nextTick(() => document.getElementById(dialogId)?.focus({ preventScroll: true }))
  // #endif
})
onUpdated(measure)
onUnmounted(() => {
  alive = false
  // #ifndef H5
  uni.offKeyboardHeightChange?.(keyboardChanged)
  // #endif
  // #ifdef H5
  document.removeEventListener('keydown', keydown, true); window.removeEventListener('resize', measure)
  document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = rootOverflow
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  // #endif
})
</script>
<template>
  <view class="dialog-overlay" :style="{ bottom: keyboardHeight + 'px' }" @touchmove.stop.prevent>
    <view class="dialog-mask" aria-hidden="true" />
    <view :id="dialogId" class="dialog-window" role="dialog" aria-modal="true" :aria-label="title" :aria-busy="busy" tabindex="-1" @tap.stop @touchmove.stop>
      <view class="dialog-header"><text class="dialog-title">{{ title }}</text><button class="dialog-close" :disabled="busy" aria-label="关闭确认窗口" @tap="close">关闭</button></view>
      <scroll-view scroll-y class="dialog-body" :style="{ height: bodyHeight }" :scroll-into-view="scrollIntoView" :scroll-with-animation="false"><view class="dialog-content"><slot /></view></scroll-view>
      <view class="dialog-footer"><slot name="footer" /></view>
    </view>
  </view>
</template>
<style scoped>
.dialog-overlay { position:fixed; inset:0; z-index:1200; display:flex; align-items:center; justify-content:center; padding:24px 20px; padding-top:calc(24px + env(safe-area-inset-top)); padding-bottom:calc(24px + env(safe-area-inset-bottom)); box-sizing:border-box; }
.dialog-mask { position:absolute; inset:0; background:rgba(15,31,21,.55); }
.dialog-window { position:relative; width:100%; max-width:560px; min-width:0; overflow:hidden; border-radius:24rpx; background:var(--color-surface,#fff); color:var(--color-foreground,#18221c); box-shadow:0 16px 48px rgba(15,31,21,.24); }
.dialog-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16rpx; padding:24rpx 28rpx; border-bottom:1px solid var(--color-border,rgba(28,63,43,.11)); }
.dialog-title { flex:1; min-width:0; padding-top:12rpx; font-size:34rpx; line-height:1.5; font-weight:800; overflow-wrap:anywhere; }
.dialog-close { flex-shrink:0; min-width:48px; min-height:44px; margin:0; padding:10rpx 16rpx; font-size:26rpx; line-height:1.5; background:var(--color-surface-subtle,#f7f9f6); color:var(--color-muted,#5f6f65); }
.dialog-body { width:100%; min-height:0; overscroll-behavior:contain; }
.dialog-content { padding:24rpx 28rpx; overflow-wrap:anywhere; }
.dialog-footer { padding:20rpx 28rpx; border-top:1px solid var(--color-border,rgba(28,63,43,.11)); background:var(--color-surface,#fff); }
.dialog-close:focus-visible { outline:2px solid var(--color-primary,#17653d); outline-offset:-3px; }
.dialog-window:focus { outline:none; }
@media (max-height:480px) { .dialog-overlay { padding-top:12px; padding-bottom:12px; }.dialog-header,.dialog-footer { padding-top:12rpx; padding-bottom:12rpx; } }
</style>
