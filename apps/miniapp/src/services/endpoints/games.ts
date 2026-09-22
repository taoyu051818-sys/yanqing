import { api, request } from "../http";
import type {
  GameDetail,
  GameParticipants,
  GameListItem,
} from "../../types/game";

export const gamesEndpoints = {
  publicGames: () =>
    request<GameListItem[]>({ url: "/games/public", method: "GET" }),
  games: () => request<GameListItem[]>({ url: "/games", method: "GET" }),
  game: (id: string) => api.get<GameDetail>(`/games/${encodeURIComponent(id)}`),
  gameParticipants: (id: string) =>
    request<GameParticipants>({
      url: `/games/${encodeURIComponent(id)}/participants`,
      method: "GET",
    }),
  createGame: (data: object) => api.post("/games", data),
  applyHost: () => api.post("/games/hosts/apply"),
  hostApplications: () => api.get<any[]>("/games/host-applications"),
  approveHost: (userId: string, data: object = {}) =>
    api.post(`/games/hosts/${userId}/approve`, data),
  rejectHost: (userId: string, reason: string) =>
    api.post(`/games/hosts/${userId}/reject`, { reason }),
  publishGame: (id: string, data: object = {}) =>
    api.post(`/games/${id}/publish`, data),
  cancelGame: (id: string, data: object) =>
    api.post(`/games/${id}/cancel`, data),
  registerGame: (id: string, creationIdempotencyKey?: string) =>
    request({
      url: `/games/${encodeURIComponent(id)}/register`,
      method: "POST",
      data: {
        sourceChannel: "MINI_PROGRAM",
        creationIdempotencyKey,
      },
    }),
  promoteGameWaitlist: (id: string) =>
    api.post(`/games/${id}/promote-waitlist`),
  grantMaturedGameRewards: () => api.post("/games/rewards/grant-matured"),
  managedGames: () => api.get<any[]>("/games/managed"),
  checkInGame: (gameId: string, userId: string, data: object = {}) =>
    api.post(`/games/${gameId}/check-in/${userId}`, data),
  completeGame: (gameId: string) => api.post(`/games/${gameId}/complete`),
};
