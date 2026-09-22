import { api, request, upload } from "../http";
import type { SessionUser } from "../../types/domain";

export const sessionEndpoints = {
  wechatLogin: (code: string) =>
    api.post<{ accessToken: string; user: SessionUser }>("/auth/wechat-login", {
      code,
    }),
  devLogin: (role: string) =>
    api.post<{ accessToken: string; user: SessionUser }>("/auth/dev-login", {
      role,
    }),
  me: () => request<SessionUser>({ url: "/auth/me", method: "GET" }),
  updateMyProfile: (displayName: string) =>
    api.patch<SessionUser>("/auth/profile", { displayName }),
  uploadMyAvatar: (filePath: string) =>
    upload<SessionUser>("/auth/profile/avatar", filePath, "avatar"),
  createDataErasureRequest: (data: object) =>
    api.post<any>("/privacy/erasure-requests", data),
  myDataErasureRequests: () => api.get<any[]>("/privacy/erasure-requests/me"),
  cancelDataErasureRequest: (id: string, data: object) =>
    api.post<any>(`/privacy/erasure-requests/${id}/cancel`, data),
  dataErasureRequests: (params: Record<string, any> = {}) =>
    api.get<any>("/privacy/erasure-requests", params),
  dataErasureBlockers: (id: string) =>
    api.get<any[]>(`/privacy/erasure-requests/${id}/blockers`),
  decideDataErasureRequest: (
    id: string,
    action: "reject" | "complete",
    data: object,
  ) => api.post<any>(`/privacy/erasure-requests/${id}/${action}`, data),
};
