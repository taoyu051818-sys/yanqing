import { onUnmounted, ref } from 'vue';
import { endpoints } from '../../../../../services/api';
import { captureAuthSession, isAuthSessionCurrent } from '../../../../../services/auth-session';
import type { MemberDirectoryItem } from '../../../../../types/domain';
import type { TrainingStudentSummary } from '../../../../../types/training-operations';

export function useTrialStudentRegistration(onSelect: (student: TrainingStudentSummary) => void) {
  const name = ref(''), guardian = ref<MemberDirectoryItem | null>(null);
  const consent = ref(false), busy = ref(false), error = ref('');
  let alive = true;
  onUnmounted(() => { alive = false; });
  async function save() {
    if (busy.value) return;
    error.value = '';
    const displayName = name.value.trim();
    if (!displayName || displayName.length > 40) { error.value = '请输入学员姓名，最多 40 个字'; return; }
    if (!guardian.value) { error.value = '请选择学员的监护人会员'; return; }
    if (!consent.value) { error.value = '请先确认监护人同意建档和预约试听'; return; }
    const auth = captureAuthSession();
    busy.value = true;
    try {
      const student = await endpoints.createTrainingStudent({
        displayName, guardianId: guardian.value.id, guardianConsentStatus: true,
        authorizationNote: '工作人员确认监护人同意建档和预约试听',
      });
      if (alive && isAuthSessionCurrent(auth)) onSelect(student);
    } catch (cause: any) {
      if (alive && isAuthSessionCurrent(auth)) error.value = cause.message || '保存学员失败，请重试';
    } finally { busy.value = false; }
  }
  return { name, guardian, consent, busy, error, save };
}
