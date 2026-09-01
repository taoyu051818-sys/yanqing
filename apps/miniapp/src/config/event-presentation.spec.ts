import { describe, expect, it } from 'vitest'

import { presentPrizePool } from './event-presentation'

describe('event prize-pool presentation', () => {
  it('uses business labels and structured values without exposing raw keys', () => {
    const rows = presentPrizePool({
      badmintonCoins: 3000,
      champion: { name: '训练羽毛球', quantity: 2 },
      internal_rule_v1: { amountCents: 8800 },
    })

    expect(rows).toEqual([
      expect.objectContaining({ label: '羽毛球币奖池', value: '3000 羽毛球币' }),
      expect.objectContaining({ label: '冠军奖励', value: '奖品：训练羽毛球 · 数量：2' }),
      expect.objectContaining({ label: '其他奖项', value: '金额：¥88.00' }),
    ])
    expect(JSON.stringify(rows.map(({ label, value }) => ({ label, value })))).not.toContain('internal_rule_v1')
  })
})
