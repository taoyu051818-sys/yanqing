import { expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { createSettlement } from './training-settlements.js';
const dto = { periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', acquisitionCostCents: 100, marketingCostCents: 200 };
function fixture(patch: Record<string, unknown> = {}) {
  const winner = { id: 'winner', periodStart: new Date(dto.periodStart), periodEnd: new Date(dto.periodEnd), acquisitionCostCents: 100, marketingCostCents: 200, ...patch };
  const prisma = {
    $transaction: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('serialization failure', {code:'P2034',clientVersion:'test'})),
    trainingSettlement: {findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner)},
  };
  return {prisma,winner,run:()=>createSettlement(prisma as never,dto,{sub:'finance',roles:['FINANCE']} as never)};
}
it('replays the same period when the winner commits between recovery reads',async()=>{
  const f=fixture();expect(await f.run()).toEqual(f.winner);expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
});
it('still rejects a replay with different cost inputs',async()=>{
  await expect(fixture({marketingCostCents:201}).run()).rejects.toThrow('费用口径不同');
});
it('still rejects a different overlapping period',async()=>{
  await expect(fixture({periodStart:new Date('2026-08-02T00:00:00Z')}).run()).rejects.toThrow('重叠账期');
});
