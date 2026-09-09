import { games as seedGames } from "../catalog";
import { type JsonRecord, KEYS, read, write } from "./storage.js";

export const initialHostApplications = (): JsonRecord[] => [
  {
    id: "host-profile-mock",
    userId: "user-member",
    status: "APPLIED",
    appliedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    user: {
      id: "user-member",
      displayName: "延庆会员小林",
      phone: "13800000005",
      memberProfile: { level: "GOLD", visitCount: 18 },
    },
  },
];

export function getGames(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.games, seedGames as JsonRecord[]);
}

export function saveGames(value: JsonRecord[]) {
  return write(KEYS.games, value);
}

export function getHostApplications(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.hostApplications, initialHostApplications());
}

export function saveHostApplications(value: JsonRecord[]) {
  return write(KEYS.hostApplications, value);
}
