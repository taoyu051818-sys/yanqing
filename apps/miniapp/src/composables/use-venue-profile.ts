import { ref } from 'vue'
import { endpoints } from '../services/api'
import type { VenueProfile } from '../types/venue-settings'
export function useVenueProfile() {
  const profile = ref<VenueProfile | null>(null)
  const error = ref('')
  let sequence = 0
  async function refresh() {
    const run = ++sequence
    try {
      const result = await endpoints.venueProfile()
      if (run !== sequence) return
      profile.value = result; error.value = ''
    } catch {
      if (run === sequence) { profile.value = null; error.value = '球馆信息暂未加载，可稍后重试' }
    }
  }
  return { profile, error, refresh }
}
