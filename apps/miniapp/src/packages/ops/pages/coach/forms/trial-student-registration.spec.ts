import { beforeEach, expect, it, vi } from 'vitest';
import { useTrialStudentRegistration } from './trial-student-registration';
import { endpoints } from '../../../../../services/api';
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onUnmounted: vi.fn() }));
vi.mock('../../../../../services/api', () => ({ endpoints: { createTrainingStudent: vi.fn() } }));
vi.stubGlobal('uni', { getStorageSync: () => 'test-actor' });
beforeEach(() => { vi.clearAllMocks(); });
it('requires a name, explicit guardian and consent before creating a student', async () => {
  const selected = vi.fn(), form = useTrialStudentRegistration(selected);
  await form.save(); expect(form.error.value).toContain('姓名');
  form.name.value = '新学员'; await form.save(); expect(form.error.value).toContain('监护人会员');
  form.guardian.value = { id: 'guardian-1', displayName: '监护人' } as never;
  await form.save(); expect(form.error.value).toContain('同意');
  expect(endpoints.createTrainingStudent).not.toHaveBeenCalled();
});
it('preserves input on failure, prevents double submission and selects the saved student', async () => {
  const selected = vi.fn(), form = useTrialStudentRegistration(selected);
  form.name.value = ' 新学员 '; form.guardian.value = { id: 'guardian-1', displayName: '监护人' } as never; form.consent.value = true;
  vi.mocked(endpoints.createTrainingStudent).mockRejectedValueOnce(new Error('请重试'));
  await form.save(); expect(form.name.value).toBe(' 新学员 '); expect(selected).not.toHaveBeenCalled();
  let finish!: (value: any) => void;
  vi.mocked(endpoints.createTrainingStudent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = form.save(); await form.save();
  expect(endpoints.createTrainingStudent).toHaveBeenCalledTimes(2);
  expect(endpoints.createTrainingStudent).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: '新学员', guardianId: 'guardian-1', guardianConsentStatus: true }));
  finish({ id: 'student-1', displayName: '新学员' }); await pending;
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'student-1' }));
});
