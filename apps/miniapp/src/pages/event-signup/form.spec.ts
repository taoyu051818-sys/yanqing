import { beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useTeamSignupForm } from './use-team-signup-form'
beforeEach(() => { vi.stubGlobal('uni', { showToast: vi.fn() }) })
it('requires consent and distinct contacts for a manually entered doubles team', () => {
  const error = ref(''), p = useTeamSignupForm(error)
  Object.assign(p.form, { name: '双打队', playerAName: '甲', playerBName: '乙', playerAPhone: '13800138000', playerBPhone: '13800138001' })
  expect(p.validate()).toBe(false); expect(error.value).toContain('同意')
  p.consent.value = true; expect(p.validate()).toBe(true)
  p.form.playerBPhone = p.form.playerAPhone; expect(p.validate()).toBe(false)
  expect(error.value).toContain('相同')
})
it('an invited partner only supplies their own details; reset removes contacts and consent', () => {
  const p = useTeamSignupForm(ref(''))
  p.form.playerBName = '乙'; p.form.playerBPhone = '13800138001'; p.consent.value = true
  expect(p.validate(true)).toBe(true)
  p.mode.value = 'INVITE'; p.category.value = 'MEN_DOUBLES'; p.resetForm()
  expect(p.form.playerBPhone).toBe(''); expect(p.consent.value).toBe(false)
  expect(p.mode.value).toBe('MANUAL'); expect(p.category.value).toBe('MIXED_DOUBLES')
})
