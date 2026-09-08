import { ConflictException } from '@nestjs/common';
import { LeadStatus, type Prisma } from '../../generated/prisma/client.js';

export const LEAD_TERMINAL_STATUSES: LeadStatus[] = [
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
  LeadStatus.ARCHIVED,
];

const stageRank: Partial<Record<LeadStatus, number>> = {
  [LeadStatus.NEW]: 0,
  [LeadStatus.CONTACTING]: 1,
  [LeadStatus.TRIAL_RESERVED]: 2,
  [LeadStatus.ATTENDED]: 3,
};

export function assertLeadProgression(before: LeadStatus, after: LeadStatus) {
  if (
    stageRank[before] === undefined ||
    stageRank[after] === undefined ||
    stageRank[after]! < stageRank[before]!
  ) {
    throw new ConflictException('跟进状态不能回退或直接进入终态');
  }
}

/** Related workflows append evidence without reopening a lead or regressing it. */
export function leadEvidenceStatus(
  before: LeadStatus,
  requested?: LeadStatus,
): LeadStatus {
  if (!requested || LEAD_TERMINAL_STATUSES.includes(before)) return before;
  if (requested === LeadStatus.CONVERTED || requested === LeadStatus.LOST)
    return requested;
  if (stageRank[requested] === undefined)
    throw new ConflictException('关联业务不能归档客户线索');
  return stageRank[requested]! > stageRank[before]! ? requested : before;
}

/** Milestone fields are written only when a real transition occurs. */
export function leadTransitionData(
  before: LeadStatus,
  after: LeadStatus,
  details: {
    convertedMemberId?: string | null;
    reason?: string;
    now?: Date;
  } = {},
): Prisma.CustomerLeadUncheckedUpdateManyInput {
  if (before === after) return {};
  if (LEAD_TERMINAL_STATUSES.includes(before))
    throw new ConflictException('终态线索不能继续变更');
  if (after === LeadStatus.CONVERTED) {
    if (!details.convertedMemberId)
      throw new ConflictException('转换线索必须关联会员');
    return {
      status: after,
      convertedMemberId: details.convertedMemberId,
      convertedAt: details.now ?? new Date(),
      nextFollowUpAt: null,
    };
  }
  if (after === LeadStatus.LOST) {
    if (!details.reason?.trim())
      throw new ConflictException('线索流失必须填写原因');
    return {
      status: after,
      lostReason: details.reason.trim(),
      lostAt: details.now ?? new Date(),
      nextFollowUpAt: null,
    };
  }
  assertLeadProgression(before, after);
  return { status: after };
}
