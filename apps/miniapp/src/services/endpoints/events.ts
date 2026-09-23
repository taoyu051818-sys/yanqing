import type { PublicEventView, PublicEventDetail } from "@yanqing/shared";
import { api, request } from "../http";
import type { TeamInviteView } from "../../types/event-signup";

export const eventsEndpoints = {
  events: () => request<PublicEventView[]>({ url: "/events", method: "GET" }),
  event: (id: string) =>
    request<PublicEventDetail>({
      url: `/events/${encodeURIComponent(id)}`,
      method: "GET",
    }),
  managedEvents: () => api.get<any[]>("/events/managed"),
  managedEvent: (id: string) =>
    api.get<Record<string, any>>(`/events/managed/${id}`),
  myEventRegistration: (id: string) =>
    api.get<Record<string, any> | null>(`/events/${id}/registration/me`),
  createEvent: (data: object) => api.post("/events", data),
  publishEvent: (id: string, data: object = {}) =>
    api.post(`/events/${id}/publish`, data),
  registerEvent: (id: string, data: object) =>
    api.post(`/events/${id}/register`, {
      ...data,
      sourceChannel: "MINI_PROGRAM",
    }),
  createTeamInvite: (id: string, data: object) =>
    api.post<{ partnerInviteCode: string; expiresAt: string }>(
      `/events/${encodeURIComponent(id)}/team-invites`,
      data,
    ),
  teamInvite: (id: string, partnerInviteCode: string, authenticated = false) =>
    request<TeamInviteView>({
      url: `/events/${encodeURIComponent(id)}/team-invites/${authenticated ? "context" : "preview"}`,
      method: "POST",
      data: { partnerInviteCode },
    }),
  acceptTeamInvite: (id: string, data: object) =>
    api.post<TeamInviteView>(
      `/events/${encodeURIComponent(id)}/team-invites/accept`,
      data,
    ),
  promoteEventWaitlist: (id: string) =>
    api.post(`/events/${id}/promote-waitlist`),
  cancelEventRegistration: (id: string, data: object) =>
    api.post(`/events/${id}/registration/cancel`, data),
  cancelEvent: (id: string, data: object) =>
    api.post(`/events/${id}/cancel`, data),
  nextEventRound: (eventId: string) =>
    api.post(`/events/${eventId}/rounds/next`),
  correctEventPairings: (eventId: string, round: number, data: object) =>
    api.post(`/events/${eventId}/rounds/${round}/pairings/correct`, data),
  scoreEventMatch: (matchId: string, scoreA: number, scoreB: number) =>
    api.post(`/events/matches/${matchId}/score`, { scoreA, scoreB }),
  correctEventScore: (matchId: string, data: object) =>
    api.post(`/events/matches/${matchId}/correct`, data),
  checkInEventTeam: (eventId: string, teamId: string, data: object = {}) =>
    api.post(`/events/${eventId}/teams/${teamId}/check-in`, data),
  finishEvent: (eventId: string) => api.post(`/events/${eventId}/finish`),
  eventPrizes: (eventId: string) => api.get<any[]>(`/events/${eventId}/prizes`),
  issueEventPrize: (eventId: string, data: object) =>
    api.post(`/events/${eventId}/prizes`, data),
  receiveEventPrize: (eventId: string, awardId: string, data: object) =>
    api.post(`/events/${eventId}/prizes/${awardId}/receive`, data),
};
