export function parseAdminLoginCode(value: string): { id: string; scanSecret: string } | null {
  const match = /^yanqing-admin:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9_-]{43})$/.exec(value.trim())
  return match ? { id: match[1], scanSecret: match[2] } : null
}
