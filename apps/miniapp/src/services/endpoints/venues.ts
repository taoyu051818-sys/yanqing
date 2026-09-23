import type {
  VenueProfile,
  VenueSettings,
  VenueCourt,
} from "../../types/venue-settings";
import type {
  OrderView,
  ApplyVenuePriceCommand,
  VenuePriceRule,
} from "@yanqing/shared";
import { api } from "../http";
import type { CourtAvailability } from "../../types/domain";
import type { CreateVenueBookingCommand, VenueClosure } from "../api-contracts";

export const venuesEndpoints = {
  venueProfile: () => api.get<VenueProfile>("/venues/profile"),
  venueSettings: () => api.get<VenueSettings>("/venues/settings"),
  saveVenueSettings: (data: object) => api.post("/venues/settings", data),
  deleteVenueCourt: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/venues/courts/${id}`),
  createVenueCourt: (data: object) =>
    api.post<VenueCourt>("/venues/courts", data),
  updateVenueCourt: (id: string, data: object) =>
    api.patch<VenueCourt>(`/venues/courts/${id}`, data),
  assistedAvailability: (date: string) =>
    api.get<CourtAvailability>("/venues/availability/assisted", { date }),
  availability: (date: string) =>
    api.get<CourtAvailability>("/venues/availability", { date }),
  venueTimeSlots: () => api.get<any[]>("/venues/time-slots/manage"),
  managePriceRules: () =>
    api.get<VenuePriceRule[]>("/venues/price-rules/manage"),
  applyVenuePrice: (data: ApplyVenuePriceCommand) =>
    api.post<VenuePriceRule>("/venues/price-rules/apply", data),
  createPriceRule: (data: object) => api.post("/venues/price-rules", data),
  createPriceRuleVersion: (id: string, data: object) =>
    api.post(`/venues/price-rules/${id}/versions`, data),
  setPriceRuleStatus: (id: string, data: object) =>
    api.post(`/venues/price-rules/${id}/status`, data),
  venueClosures: (params: Record<string, any> = {}) =>
    api.get<VenueClosure[]>("/venues/closures", params),
  createVenueClosure: (data: object) =>
    api.post<VenueClosure>("/venues/closures", data),
  cancelVenueClosure: (id: string, reason: string) =>
    api.post<VenueClosure>(`/venues/closures/${id}/cancel`, { reason }),
  createBooking: (data: CreateVenueBookingCommand) =>
    api.post<OrderView>("/venues/bookings", data),
  checkInVenueOrder: (orderId: string, data: object = {}) =>
    api.post(`/venues/orders/${orderId}/check-in`, data),
  fulfillVenueOrder: (orderId: string, data: object) =>
    api.post(`/venues/orders/${orderId}/fulfillment`, data),
};
