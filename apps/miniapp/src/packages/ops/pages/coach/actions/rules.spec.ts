import { computed, ref } from 'vue';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCoachRulesActions } from './rules';
import { useYouthRuleForm } from '../forms/rule-form';
import { endpoints } from '../../../../../services/api';
vi.mock('../../../../../services/api', () => ({ endpoints: { createYouthTrainingRule: vi.fn() } }));
vi.mock('../../../../../utils/pending-creation-key', () => ({ withPendingCreationKey: (_scope: string, _command: unknown, operation: (key: string) => Promise<unknown>) => operation('rule-test-key') }));
beforeEach(() => { vi.clearAllMocks(); });
function setup() {
  const form = useYouthRuleForm(), errorMessage = ref('');
  const actions = useCoachRulesActions({ ...form, errorMessage, canDraftYouthRule: computed(() => true), actionKey: ref(''), runCreation: async (_key: string, _message: string, operation: () => Promise<unknown>) => { await operation(); return true; } } as never);
  form.ruleMaxSessions.value = '100'; form.ruleMaxValidityDays.value = '999'; form.ruleMaxAmountYuan.value = '99999';
  return { form, errorMessage, ...actions };
}
it('saves immediately with only three business limits and no mandatory note', async () => {
  const { createYouthRule } = setup();
  expect(await createYouthRule()).toBe(true);
  const command = vi.mocked(endpoints.createYouthTrainingRule).mock.calls[0][0];
  expect(command).toMatchObject({ effectiveImmediately: true, maxTotalSessions: 100, maxValidityDays: 999, maxContractAmountCents: 9999900, warningThresholdDays: 0, reason: '管理员设置课包限制' });
  expect(command).not.toHaveProperty('effectiveFrom');
});
it('only schedules when explicitly selected', async () => {
  const { form, createYouthRule } = setup();
  form.ruleEffectiveImmediately.value = false;
  form.ruleEffectiveDate.value = '2026-09-24'; form.ruleEffectiveTime.value = '09:00';
  await createYouthRule();
  expect(endpoints.createYouthTrainingRule).toHaveBeenCalledWith(expect.objectContaining({ effectiveFrom: '2026-09-24T09:00:00+08:00' }));
});
it('preserves all entered settings and explains a failed save', async () => {
  const { form, errorMessage, createYouthRule } = setup();
  vi.mocked(endpoints.createYouthTrainingRule).mockRejectedValueOnce(new Error('网络暂不可用'));
  expect(await createYouthRule()).toBe(false);
  expect(form.ruleMaxSessions.value).toBe('100');
  expect(errorMessage.value).toBe('网络暂不可用');
});
