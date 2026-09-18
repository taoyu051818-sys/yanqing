export interface VenueProfile {
  name: string
  address: string
  contactPhone: string
  latitude: number | null
  longitude: number | null
  opensAtHour: number | null
  closesAtHour: number | null
  courtCount: number
}
export interface VenueCourt {
  id: string
  code: string
  name: string
  zone: 'EAST' | 'WEST' | 'SOUTH' | 'NORTH'
  usage: 'RETAIL' | 'MEMBER_BLOCK' | 'TRAINING' | 'MAINTENANCE'
  enabled: boolean
  sortOrder: number
}
export interface VenueSettings extends VenueProfile { revision: string; courts: VenueCourt[] }
