import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  AppRole,
  LeadStatus,
  TrainingEnrollmentStatus,
} from '../../generated/prisma/client.js';

export const trialNo = () =>
  `TRY${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(2).toString('hex').toUpperCase()}`;

export const normalizedText = (
  value: string,
  label: string,
  min: number,
  max: number,
) => {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new BadRequestException(`${label}长度必须为 ${min}-${max} 个字符`);
  }
  return normalized;
};

export const optionalId = (value: string | undefined, label: string) => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(`${label}不能为空白字符`);
  return normalized;
};

export const isConcurrentWriteError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ['P2002', 'P2034'].includes(String((error as { code?: unknown }).code));

export const activeLeadStatuses: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTING,
  LeadStatus.TRIAL_RESERVED,
];

export const trialManagerRoles: AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const convertibleEnrollmentStatuses: TrainingEnrollmentStatus[] = [
  TrainingEnrollmentStatus.ACTIVE,
  TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
];

export const trialInclude = {
  lead: {
    select: {
      id: true,
      displayName: true,
      status: true,
      sourceChannel: true,
      campaign: true,
      convertedMemberId: true,
    },
  },
  student: { select: { id: true, displayName: true, guardianId: true } },
  guardian: { select: { id: true, displayName: true } },
  member: { select: { id: true, displayName: true } },
  product: true,
  class: {
    include: {
      product: true,
    },
  },
  session: true,
  coach: { select: { id: true, displayName: true } },
  convertedEnrollment: {
    include: { product: true, class: true, student: true },
  },
  transitions: {
    include: { actor: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

export const trialProductView = (product: any) =>
  product
    ? {
        id: product.id,
        name: product.name,
        audience: product.audience,
        totalSessions: product.totalSessions,
        validityDays: product.validityDays,
        priceCents: product.priceCents,
      }
    : null;

export const trainingTrialResponse = (trial: any, management: boolean) => ({
  id: trial.id,
  trialNo: trial.trialNo,
  status: trial.status,
  sourceChannel: trial.sourceChannel,
  scheduledStartsAt: trial.scheduledStartsAt,
  scheduledEndsAt: trial.scheduledEndsAt,
  checkedInAt: trial.checkedInAt,
  noShowAt: trial.noShowAt,
  assessedAt: trial.assessedAt,
  convertedAt: trial.convertedAt,
  lostAt: trial.lostAt,
  cancelledAt: trial.cancelledAt,
  assessmentDimensions: trial.assessmentDimensions,
  recommendation: trial.recommendation,
  assessmentNote: trial.assessmentNote,
  product: trialProductView(trial.product),
  student: trial.student
    ? { id: trial.student.id, displayName: trial.student.displayName }
    : null,
  guardian: trial.guardian
    ? { id: trial.guardian.id, displayName: trial.guardian.displayName }
    : null,
  member: trial.member
    ? { id: trial.member.id, displayName: trial.member.displayName }
    : null,
  coach: trial.coach
    ? { id: trial.coach.id, displayName: trial.coach.displayName }
    : null,
  class: trial.class
    ? {
        id: trial.class.id,
        name: trial.class.name,
        capacity: trial.class.capacity,
        active: trial.class.active,
        product: trialProductView(trial.class.product),
      }
    : null,
  session: trial.session
    ? {
        id: trial.session.id,
        classId: trial.session.classId,
        startsAt: trial.session.startsAt,
        endsAt: trial.session.endsAt,
        status: trial.session.status,
      }
    : null,
  ...(management
    ? {
        leadId: trial.leadId,
        studentId: trial.studentId,
        guardianId: trial.guardianId,
        memberId: trial.memberId,
        productId: trial.productId,
        classId: trial.classId,
        sessionId: trial.sessionId,
        coachId: trial.coachId,
        lead: trial.lead
          ? {
              id: trial.lead.id,
              displayName: trial.lead.displayName,
              status: trial.lead.status,
              sourceChannel: trial.lead.sourceChannel,
              campaign: trial.lead.campaign,
              convertedMemberId: trial.lead.convertedMemberId,
            }
          : null,
        convertedEnrollment: trial.convertedEnrollment
          ? {
              id: trial.convertedEnrollment.id,
              enrollmentNo: trial.convertedEnrollment.enrollmentNo,
              status: trial.convertedEnrollment.status,
              product: trialProductView(trial.convertedEnrollment.product),
              class: trial.convertedEnrollment.class
                ? {
                    id: trial.convertedEnrollment.class.id,
                    name: trial.convertedEnrollment.class.name,
                  }
                : null,
              student: trial.convertedEnrollment.student
                ? {
                    id: trial.convertedEnrollment.student.id,
                    displayName: trial.convertedEnrollment.student.displayName,
                  }
                : null,
            }
          : null,
        transitions: (trial.transitions || []).map((transition: any) => ({
          id: transition.id,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          action: transition.action,
          reason: transition.reason,
          actor: transition.actor
            ? {
                id: transition.actor.id,
                displayName: transition.actor.displayName,
              }
            : null,
          createdAt: transition.createdAt,
        })),
      }
    : {}),
});
