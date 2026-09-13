import { beforeEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useInventoryCatalogActions } from './catalog'
import { useInventoryMovementsActions } from './movements'
import { useInventoryPurchasingActions } from './purchasing'
const { api } = vi.hoisted(() => ({ api: { updateInventoryItem: vi.fn(), createInventoryOperation: vi.fn(), createPurchaseOrder: vi.fn() } }))
vi.mock('../../../../../services/api', () => ({ endpoints: api }))
const location = { id: 'source', name: '库房' }, target = { id: 'target', name: '前台' }
const item = { id: 'i', sku: 'SKU', name: '球', category: 'BALL', mode: 'PURCHASE', supplierId: 's', defaultLocationId: 'source', purchasePriceCents: 100, salePriceCents: 200, safeStock: 1, batchCode: 'OLD', expiresAt: '2027-01-01T15:59:59.000Z', stock: 12, updatedAt: '2026-09-12T00:00:00Z', stockBalances: [{ id: 'b1', locationId: 'source', batchCode: 'NEW', expiresAt: '2028-02-02T15:59:59.000Z', quantity: 2 }, { id: 'b2', locationId: 'target', batchCode: 'OLD', expiresAt: null, quantity: 10 }] }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('uni', { showModal: vi.fn(async () => ({ confirm: true })), showToast: vi.fn() }) })
it('edits a stocked item name without resending its unchanged protected expiry or batch', async () => {
  const masterForm = ref<any>({}), editingMaster = ref<any>(null)
  const actions = useInventoryCatalogActions({ masterType: ref('ITEM'), showMasterForm: ref(false), detailId: ref(''), masterDetail: ref(null), isAdmin: computed(() => true), editingMaster, masterForm, saving: ref(false), load: vi.fn(), task: {} } as any)
  actions.openMasterForm(item); masterForm.value.name = '新名称'; masterForm.value.reason = '资料修正'; await actions.submitMasterForm()
  expect(api.updateInventoryItem).toHaveBeenCalledWith('i', expect.objectContaining({ name: '新名称', expectedUpdatedAt: item.updatedAt }))
  const payload = api.updateInventoryItem.mock.calls[0][1]; expect(payload).not.toHaveProperty('expiresAt'); expect(payload).not.toHaveProperty('batchCode')
})
it('moves the selected persisted bucket with its exact expiry and enforces its local quantity', async () => {
  const movementForm = ref<any>({}), validationError = vi.fn(() => null)
  const actions = useInventoryMovementsActions({ movementType: ref('TRANSFER'), movementForm, showMovementForm: ref(false), activeItems: computed(() => [item]), activeLocations: computed(() => [location, target]), movementTargetLocations: computed(() => [target]), validationError, formPositiveInteger: Number, saving: ref(false), run: async (action: () => unknown) => { await action(); return true }, isAdmin: computed(() => true) } as any)
  actions.openMovementForm('TRANSFER'); actions.selectMovementItem(0); actions.selectMovementSource(0); actions.selectMovementTarget(0)
  expect(actions.movementBalances.value).toHaveLength(1); actions.selectMovementBalance(0)
  movementForm.value.quantity = '3'; movementForm.value.reason = '前台补货'; await actions.submitMovement(); expect(api.createInventoryOperation).not.toHaveBeenCalled()
  movementForm.value.quantity = '2'; await actions.submitMovement()
  expect(api.createInventoryOperation).toHaveBeenCalledWith(expect.objectContaining({ sourceLocationId: 'source', targetLocationId: 'target', batchCode: 'NEW', expiresAt: item.stockBalances[0].expiresAt, quantity: 2 }))
})
it('records the actual purchase batch and expiry instead of dropping expiry on receipt', async () => {
  const purchaseForm = ref<any>({})
  const actions = useInventoryPurchasingActions({ purchaseForm, showPurchaseForm: ref(false), activeSuppliers: computed(() => [{ id: 's' }]), purchaseItems: computed(() => [item]), activeLocations: computed(() => [location]), validationError: vi.fn(() => null), formPositiveInteger: Number, saving: ref(false), run: async (action: () => unknown) => { await action(); return true }, task: {}, load: vi.fn(), isAdmin: computed(() => true) } as any)
  actions.openPurchaseForm(); actions.selectPurchaseSupplier(0); actions.selectPurchaseItem(0); actions.selectPurchaseLocation(0)
  expect(purchaseForm.value.expiresAt).toBe('2027-01-01'); purchaseForm.value.batchCode = 'ACTUAL'; purchaseForm.value.expiresAt = '2028-02-02'; purchaseForm.value.quantity = '3'; await actions.submitPurchaseOrder()
  expect(api.createPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ batchCode: 'ACTUAL', expiresAt: '2028-02-02T23:59:59+08:00', orderedQuantity: 3 })] }))
})
it('uses the target location bucket exact timestamp when purchasing an existing batch', async () => {
  const existing = { ...item, stockBalances: [{ id: 'actual', locationId: 'source', batchCode: 'ACTUAL', expiresAt: '2027-02-01T00:00:00.000Z', quantity: 2 }] }
  const purchaseForm = ref<any>({})
  const actions = useInventoryPurchasingActions({ purchaseForm, showPurchaseForm: ref(false), activeSuppliers: computed(() => [{ id: 's' }]), purchaseItems: computed(() => [existing]), activeLocations: computed(() => [location]), validationError: vi.fn(() => null), formPositiveInteger: Number, saving: ref(false), run: async (action: () => unknown) => { await action(); return true }, task: {}, load: vi.fn(), isAdmin: computed(() => true) } as any)
  actions.openPurchaseForm(); actions.selectPurchaseSupplier(0); actions.selectPurchaseItem(0); actions.selectPurchaseLocation(0)
  purchaseForm.value.batchCode = 'ACTUAL'; actions.syncPurchaseBatch(); expect(purchaseForm.value.expiresAt).toBe('2027-02-01'); purchaseForm.value.quantity = '1'; await actions.submitPurchaseOrder()
  expect(api.createPurchaseOrder.mock.calls[0][0].lines[0].expiresAt).toBe('2027-02-01T00:00:00.000Z')
})
