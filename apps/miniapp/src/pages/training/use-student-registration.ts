import { computed, ref } from "vue";

import { useSessionStore } from "../../stores/session";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";

/** Owns the guardian's student draft and its submission lifecycle. */
export function useStudentRegistration({
  login,
  reload,
  onCreated,
}: {
  login: () => unknown;
  reload: () => Promise<void>;
  onCreated: (id: string) => void;
}) {
  const session = useSessionStore();
  const savingStudent = ref(false);
  const showStudentForm = ref(false);
  const defaultBirthMonth = `${new Date().getFullYear() - 10}-01`;
  const studentForm = ref({
    displayName: "",
    birthMonth: defaultBirthMonth,
    guardianConsentStatus: false,
  });
  const maxBirthMonth = computed(() => new Date().toISOString().slice(0, 7));
  function openStudentForm() {
    if (!session.isAuthenticated) return login();
    showStudentForm.value = true;
    uni.pageScrollTo({ scrollTop: 0, duration: 200 });
  }
  const setBirthMonth = (event: { detail: { value: string } }) => {
    studentForm.value.birthMonth = String(event.detail.value);
  };
  const setConsent = (event: Event | { detail: { value: boolean } }) => {
    studentForm.value.guardianConsentStatus =
      "detail" in event && Boolean(event.detail.value);
  };
  async function createStudent() {
    if (!session.isAuthenticated) return login();
    if (savingStudent.value) return;
    const displayName = studentForm.value.displayName.trim();
    if (!displayName)
      return uni.showToast({ title: "请填写学员姓名", icon: "none" });
    if (!studentForm.value.guardianConsentStatus) {
      return uni.showToast({ title: "需由监护人确认授权", icon: "none" });
    }
    savingStudent.value = true;
    const owner = captureAuthSession();
    try {
      const created = await endpoints.createTrainingStudent({
        displayName,
        birthMonth: `${studentForm.value.birthMonth}-01T00:00:00.000Z`,
        guardianConsentStatus: true,
      });
      if (!isAuthSessionCurrent(owner)) return;
      studentForm.value = {
        displayName: "",
        birthMonth: defaultBirthMonth,
        guardianConsentStatus: false,
      };
      showStudentForm.value = false;
      await reload();
      if (!isAuthSessionCurrent(owner)) return;
      onCreated(created.id);
      uni.showToast({ title: "学员档案已建立", icon: "success" });
    } catch (cause: any) {
      if (!isAuthSessionCurrent(owner)) return;
      uni.showToast({ title: cause.message, icon: "none" });
    } finally {
      savingStudent.value = false;
    }
  }
  function resetStudent() {
    showStudentForm.value = false;
    studentForm.value = {
      displayName: "",
      birthMonth: defaultBirthMonth,
      guardianConsentStatus: false,
    };
  }

  return {
    savingStudent,
    showStudentForm,
    studentForm,
    maxBirthMonth,
    setBirthMonth,
    setConsent,
    openStudentForm,
    createStudent,
    resetStudent,
  };
}
