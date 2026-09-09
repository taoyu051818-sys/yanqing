import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  leadEvidenceStatus,
  leadTransitionData,
} from '../../common/leads/lead-state.js';
import {
  AppRole,
  LeadStatus,
  Prisma,
  TrainingTrialStatus,
} from '../../generated/prisma/client.js';

export function assertRole(actor: AuthUser, roles: AppRole[], message: string) {
  if (!actor.roles.some((role) => roles.includes(role))) {
    throw new ForbiddenException(message);
  }
}

export async function appendLeadEvidence(
  tx: Prisma.TransactionClient,
  lead: {
    id: string;
    status: LeadStatus;
    convertedMemberId?: string | null;
  },
  actor: AuthUser,
  requestedStatus: LeadStatus | undefined,
  kind: string,
  reason: string,
  convertedMemberId?: string | null,
) {
  if (
    convertedMemberId &&
    lead.convertedMemberId &&
    convertedMemberId !== lead.convertedMemberId
  ) {
    throw new ConflictException('试听转换会员与线索已关联会员不一致');
  }
  const statusAfter = leadEvidenceStatus(lead.status, requestedStatus);
  const data = leadTransitionData(lead.status, statusAfter, {
    convertedMemberId,
    reason,
  });
  if (statusAfter !== lead.status) {
    const changed = await tx.customerLead.updateMany({
      where: { id: lead.id, status: lead.status },
      data,
    });
    if (changed.count !== 1)
      throw new ConflictException('线索状态已变化，请刷新后重试');
  }
  await tx.leadFollowUp.create({
    data: {
      leadId: lead.id,
      actorId: actor.sub,
      kind,
      content: reason,
      statusBefore: lead.status,
      statusAfter,
    },
  });
}

export function audit(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  trialId: string,
  action: string,
  before: TrainingTrialStatus | null,
  after: TrainingTrialStatus,
  reason: string,
  requestId: string,
  details: Record<string, unknown>,
) {
  return tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: actor.roles[0],
      action,
      objectType: 'TrainingTrial',
      objectId: trialId,
      reason,
      requestId,
      oldValue: { status: before } as never,
      newValue: { status: after, ...details } as never,
    },
  });
}
