const prizePoolLabels: Record<string, string> = {
  champion: '冠军奖励',
  runnerUp: '亚军奖励',
  thirdPlace: '季军奖励',
  badmintonCoins: '羽毛球币奖池',
  sponsorCoupons: '合作方优惠券',
  participation: '参与奖励',
}

const nestedLabels: Record<string, string> = {
  name: '奖品',
  awardName: '奖项',
  quantity: '数量',
  count: '数量',
  amount: '金额',
  amountCents: '金额',
}

const formatValue = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '待配置'
  if (typeof value === 'boolean') return value ? '已启用' : '未启用'
  if (typeof value === 'number') {
    if (key === 'badmintonCoins') return `${value} 羽毛球币`
    if (key === 'sponsorCoupons') return `${value} 张`
    if (/Cents$/.test(key)) return `¥${(value / 100).toFixed(2)}`
    return String(value)
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.map((item) => formatValue('', item)).filter(Boolean)
    return parts.length ? parts.join('、') : '待配置'
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([nestedKey, nestedValue]) =>
        `${nestedLabels[nestedKey] || '配置'}：${formatValue(nestedKey, nestedValue)}`,
    )
    return parts.length ? parts.join(' · ') : '待配置'
  }
  return '待配置'
}

export function presentPrizePool(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).map(
    ([key, entry], index) => ({
      id: `${index}-${key}`,
      label: prizePoolLabels[key] || '其他奖项',
      value: formatValue(key, entry),
    }),
  )
}
