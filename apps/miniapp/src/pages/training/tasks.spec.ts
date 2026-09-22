import { beforeEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import * as auth from '../../services/auth-session'
import * as refundRules from '../../utils/training-refund'
import { deferred, loadTaskScript } from '../../test-utils/sfc-script'

const session = { isAuthenticated: true }
const storage = new Map<string, unknown>()
const navigate = vi.fn(), login = vi.fn(), reload = vi.fn(async () => {}), onCreated = vi.fn()
function task(file: string, endpoints: Record<string, unknown>) {
  return loadTaskScript(new URL(`./${file}.ts`, import.meta.url), id => {
    if (id === 'vue') return vue
    if (id.endsWith('/services/api')) return { endpoints }
    if (id.endsWith('/services/auth-session')) return auth
    if (id.endsWith('/stores/session')) return { useSessionStore: () => session }
    if (id.endsWith('/utils/training-refund')) return refundRules
    if (id.endsWith('/utils/member-navigation')) return { openMemberPage: navigate }
    if (id.endsWith('/utils/pending-creation-key')) return { withPendingCreationKey: (_scope: string, _command: unknown, send: (key: string) => unknown) => send('key') }
    throw new Error(id)
  })
}
beforeEach(() => {
  storage.clear(); vi.clearAllMocks(); session.isAuthenticated = true
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key), showToast: vi.fn(), pageScrollTo: vi.fn() })
  auth.saveAuthSession('first', 'member-a')
})
it('requires a valid class and guardian-authorized student before creating a youth order', async () => {
  const purchaseTraining = vi.fn()
  const { useCoursePurchase } = task('use-course-purchase', { purchaseTraining })
  const p = useCoursePurchase({ students: vue.ref([{ id: 'student', guardianConsentStatus: false }]), login, onNeedsStudent: vi.fn() })
  const product = { id: 'course', audience: 'YOUTH', classes: [{ id: 'class' }] }
  await p.purchase(product); expect(p.purchaseError.value).toContain('班级')
  p.selectedClassId.value = 'class'; p.selectedStudentId.value = 'student'
  await p.purchase(product); expect(p.purchaseError.value).toContain('监护人授权')
  expect(purchaseTraining).not.toHaveBeenCalled()
})
it('an unrestricted course bought for self does not reuse a previously selected child', async () => {
  const purchaseTraining = vi.fn(async () => ({ id: 'order' }))
  const { useCoursePurchase } = task('use-course-purchase', { purchaseTraining })
  const p = useCoursePurchase({ students: vue.ref([{ id: 'student', guardianConsentStatus: true }]), login, onNeedsStudent: vi.fn() })
  const product = { id: 'course', audience: 'ALL', classes: [{ id: 'class' }] }
  p.preparePurchase(product); await p.purchase(product)
  expect(purchaseTraining).toHaveBeenCalledWith(expect.objectContaining({ classId: 'class', studentId: undefined }))
  expect(navigate).toHaveBeenCalledWith('/pages/order/index?id=order')
})
it('a late course order does not navigate the next logged-in account', async () => {
  const result = deferred(); const { useCoursePurchase } = task('use-course-purchase', { purchaseTraining: () => result.promise })
  const p = useCoursePurchase({ students: vue.ref([]), login, onNeedsStudent: vi.fn() })
  const pending = p.purchase({ id: 'course', audience: 'ADULT', classes: [] })
  auth.saveAuthSession('second', 'member-b'); p.resetPurchase(); result.resolve({ id: 'old-order' }); await pending
  expect(navigate).not.toHaveBeenCalled(); expect(p.purchasingId.value).toBe('')
})
it('a student creation response cannot select a child after the account changes', async () => {
  const result = deferred(); const { useStudentRegistration } = task('use-student-registration', { createTrainingStudent: () => result.promise })
  const p = useStudentRegistration({ login, reload, onCreated })
  p.studentForm.value.displayName = '学员'; p.studentForm.value.guardianConsentStatus = true
  const pending = p.createStudent(); auth.saveAuthSession('second', 'member-b'); p.resetStudent()
  result.resolve({ id: 'old-student' }); await pending
  expect(onCreated).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled(); expect(uni.showToast).not.toHaveBeenCalled()
})
it('refund submission respects the current order limit and preserves retry after invalid input', async () => {
  const refundOrder = vi.fn(async () => ({}))
  const { useTrainingRefund } = task('use-training-refund', { order: async () => ({ id: 'order', paidCents: 10000, refundedCents: 2000, refunds: [], status: 'PARTIALLY_REFUNDED' }), refundOrder })
  const p = useTrainingRefund({ login, reload }); const item = { id: 'enrollment', orderId: 'order', prepaidBalanceCents: 6000 }
  await p.prepareRefund(item); expect(p.refundMaximum.value).toBe(6000)
  p.customRefund.value = true; p.refundAmount.value = '60.01'
  await p.requestTrainingRefund(item, '不再上课'); expect(refundOrder).not.toHaveBeenCalled()
  p.refundAmount.value = '60.00'; await p.requestTrainingRefund(item, '不再上课')
  expect(refundOrder).toHaveBeenCalledWith('order', expect.objectContaining({ amountCents: 6000 }))
  expect(navigate).toHaveBeenCalledWith('/pages/order/index?id=order')
})
it('a pending refund prevents another request from the member task', async () => {
  const refundOrder = vi.fn(); const { useTrainingRefund } = task('use-training-refund', { order: async () => ({ status: 'REFUND_PENDING', refunds: [] }), refundOrder })
  const p = useTrainingRefund({ login, reload }); const item = { id: 'enrollment', orderId: 'order', prepaidBalanceCents: 6000 }
  await p.prepareRefund(item); await p.requestTrainingRefund(item, '原因')
  expect(p.refundOrder.value).toBeNull(); expect(p.refundError.value).toContain('处理中'); expect(refundOrder).not.toHaveBeenCalled()
})
