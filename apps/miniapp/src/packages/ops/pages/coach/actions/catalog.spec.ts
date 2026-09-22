import { computed, ref } from 'vue';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCoachCatalogActions } from './catalog';
import { useTrainingProductForm } from '../forms/product-form';
import { endpoints } from '../../../../../services/api';
vi.mock('../../../../../services/api', () => ({ endpoints: { createTrainingProduct: vi.fn() } }));
vi.mock('../../../../../utils/pending-creation-key', () => ({ withPendingCreationKey: (_scope: string, _command: unknown, operation: (key: string) => Promise<unknown>) => operation('creation-test-key') }));
vi.stubGlobal('uni', { showModal: vi.fn(async () => ({ confirm: true })), showToast: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); });
function setup() {
  const form = useTrainingProductForm(), errorMessage = ref('');
  const actions = useCoachCatalogActions({ ...form, errorMessage, canConfigureTraining: computed(() => true), actionKey: ref(''), runCreation: async (_key: string, _message: string, operation: () => Promise<unknown>) => { await operation(); return true; } } as never);
  form.productCode.value = '一对一'; form.productName.value = '一对一';
  return { form, errorMessage, ...actions };
}
it('creates the pictured course without requiring an operational explanation', async () => {
  const { form, createProduct } = setup();
  form.productAudienceIndex.value = form.audienceOptions.findIndex(item => item.value === 'ALL');
  await createProduct();
  expect(endpoints.createTrainingProduct).toHaveBeenCalledWith(expect.objectContaining({ code: '一对一', name: '一对一', audience: 'ALL', totalSessions: 12, priceCents: 128000, reason: '创建课程产品' }));
  expect(form.productName.value).toBe('');
});
it('preserves the draft and shows an actionable error when saving fails', async () => {
  const { form, errorMessage, createProduct } = setup();
  vi.mocked(endpoints.createTrainingProduct).mockRejectedValueOnce(new Error('课程产品编码已存在，请更换编码'));
  await createProduct();
  expect(form.productName.value).toBe('一对一'); expect(errorMessage.value).toContain('编码已存在');
  expect(uni.showToast).not.toHaveBeenCalled();
});

it('omits a blank product code and leaves generation to the server', async () => {
 const {form, createProduct} = setup(); form.productCode.value = ''; await createProduct();
 expect(endpoints.createTrainingProduct).toHaveBeenCalledOnce(); expect(vi.mocked(endpoints.createTrainingProduct).mock.calls[0][0]).not.toHaveProperty('code');
});

it('identifies the invalid course field without sending a request or opening a dialog', async () => {
 const {form, createProduct, catalogValidationField, errorMessage} = setup(); form.productName.value = ''; await createProduct();
 expect(catalogValidationField.value).toBe('productName'); expect(errorMessage.value).toContain('课程名称');
 expect(endpoints.createTrainingProduct).not.toHaveBeenCalled(); expect(uni.showModal).not.toHaveBeenCalled(); expect(uni.showToast).not.toHaveBeenCalled();
});
it('keeps a price error next to its field and clears it explicitly while editing', async () => {
 const {form, createProduct, catalogValidationField, errorMessage, clearCatalogError} = setup(); form.productPriceYuan.value = '1.999'; await createProduct();
 expect(catalogValidationField.value).toBe('productPriceYuan'); expect(errorMessage.value).toContain('两位小数');
 clearCatalogError(); expect(catalogValidationField.value).toBe(''); expect(errorMessage.value).toBe('');
});
