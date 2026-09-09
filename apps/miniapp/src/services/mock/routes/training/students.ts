import { mockUser } from "../../core";
import { getStudents, saveStudents } from "../../state";
import { ok, requireMockRole, text, newId } from "../../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleTrainingStudentsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/students" && method === "GET") {
    return {
      handled: true,
      value: ok(
        getStudents().filter((student) => student.guardianId === mockUser().id),
      ),
    };
  }
  return { handled: false };
}

export async function handleTrainingAdminStudentsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/admin/students" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const guardianId = text(data?.guardianId);
    return {
      handled: true,
      value: ok(
        getStudents().filter(
          (student) => !guardianId || student.guardianId === guardianId,
        ),
      ),
    };
  }
  return { handled: false };
}

export async function handleTrainingStudentsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/students" && method === "POST") {
    const displayName = text(data.displayName);
    if (!displayName) throw new Error("学员姓名不能为空");
    const guardianId = text(data.guardianId) || mockUser().id;
    const actingForAnotherGuardian = guardianId !== mockUser().id;
    if (actingForAnotherGuardian)
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const guardianConsentStatus = data.guardianConsentStatus === true;
    const authorizationNote = text(data.authorizationNote);
    if (
      actingForAnotherGuardian &&
      guardianConsentStatus &&
      !authorizationNote
    ) {
      throw new Error("代监护人登记授权时必须填写授权凭证说明");
    }
    const birthMonth = data.birthMonth
      ? new Date(String(data.birthMonth))
      : null;
    if (
      birthMonth &&
      (Number.isNaN(birthMonth.getTime()) || birthMonth > new Date())
    ) {
      throw new Error("出生月份格式无效或晚于当前月份");
    }
    const student = {
      id: newId("student"),
      guardianId,
      displayName,
      birthMonth: birthMonth?.toISOString() || null,
      guardianConsentStatus,
      authorizationNote:
        authorizationNote ||
        (guardianConsentStatus ? "监护人通过小程序确认授权" : null),
      guardian: {
        id: guardianId,
        displayName: actingForAnotherGuardian
          ? "指定监护人"
          : mockUser().displayName,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveStudents([student, ...getStudents()]);
    return { handled: true, value: ok(student) };
  }
  return { handled: false };
}

export async function handleTrainingStudentPatch(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const trainingStudentMatch = url.match(/^\/training\/students\/([^/]+)$/);
  if (trainingStudentMatch && method === "PATCH") {
    const students = getStudents();
    const student = students.find(
      (item) => item.id === trainingStudentMatch[1],
    );
    if (!student) throw new Error("学员档案不存在");
    const actingForAnotherGuardian = student.guardianId !== mockUser().id;
    if (actingForAnotherGuardian)
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    if (data.displayName !== undefined && !text(data.displayName))
      throw new Error("学员姓名不能为空");
    if (
      actingForAnotherGuardian &&
      data.guardianConsentStatus === true &&
      !student.guardianConsentStatus &&
      !text(data.authorizationNote)
    ) {
      throw new Error("代监护人确认授权时必须填写授权凭证说明");
    }
    const birthMonth =
      data.birthMonth === undefined
        ? undefined
        : new Date(String(data.birthMonth));
    if (
      birthMonth &&
      (Number.isNaN(birthMonth.getTime()) || birthMonth > new Date())
    ) {
      throw new Error("出生月份格式无效或晚于当前月份");
    }
    Object.assign(student, {
      ...(data.displayName === undefined
        ? {}
        : { displayName: text(data.displayName) }),
      ...(birthMonth === undefined
        ? {}
        : { birthMonth: birthMonth.toISOString() }),
      ...(data.guardianConsentStatus === undefined
        ? {}
        : { guardianConsentStatus: data.guardianConsentStatus === true }),
      ...(data.authorizationNote === undefined
        ? {}
        : { authorizationNote: text(data.authorizationNote) }),
      updatedAt: new Date().toISOString(),
    });
    if (
      !actingForAnotherGuardian &&
      data.guardianConsentStatus === true &&
      !student.authorizationNote
    ) {
      student.authorizationNote = "监护人通过小程序确认授权";
    }
    saveStudents(students);
    return { handled: true, value: ok(student) };
  }
  return { handled: false };
}
