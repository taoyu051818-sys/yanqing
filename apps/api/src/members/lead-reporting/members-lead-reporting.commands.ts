import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BusinessType,
  LeadStatus,
  SourceChannel,
} from '../../generated/prisma/client.js';
import type { LeadFunnelQueryDto } from '../members.dto.js';
import {
  FUNNEL_ORDER_STATUSES,
  FunnelBucket,
} from '../shared/members-support.js';

export async function leadFunnel(
  prisma: PrismaService,
  query: LeadFunnelQueryDto,
) {
  const periodEnd = query.to ? new Date(query.to) : new Date();
  const periodStart = query.from
    ? new Date(query.from)
    : new Date(periodEnd.getTime() - 30 * 86_400_000);
  if (
    !Number.isFinite(periodStart.getTime()) ||
    !Number.isFinite(periodEnd.getTime()) ||
    periodEnd <= periodStart
  ) {
    throw new BadRequestException('渠道漏斗统计周期无效');
  }
  if (periodEnd.getTime() - periodStart.getTime() > 366 * 86_400_000) {
    throw new BadRequestException('渠道漏斗单次统计范围不能超过366天');
  }

  const [members, orders] = await Promise.all([
    prisma.memberProfile.findMany({
      where: {
        OR: [
          { createdAt: { gte: periodStart, lt: periodEnd } },
          { firstVisitAt: { gte: periodStart, lt: periodEnd } },
        ],
      },
      select: {
        userId: true,
        sourceChannel: true,
        createdAt: true,
        firstVisitAt: true,
      },
    }),
    prisma.order.findMany({
      where: {
        status: { in: FUNNEL_ORDER_STATUSES },
        paidAt: { gte: periodStart, lt: periodEnd },
      },
      select: {
        memberId: true,
        sourceChannel: true,
        businessType: true,
        paidCents: true,
        refundedCents: true,
      },
    }),
  ]);
  const attributedMemberIds = [
    ...new Set(orders.map((order) => order.memberId)),
  ];
  const leads = await prisma.customerLead.findMany({
    where: {
      OR: [
        { createdAt: { gte: periodStart, lt: periodEnd } },
        ...(attributedMemberIds.length
          ? [{ convertedMemberId: { in: attributedMemberIds } }]
          : []),
      ],
    },
    select: {
      sourceChannel: true,
      campaign: true,
      status: true,
      convertedMemberId: true,
      createdAt: true,
      convertedAt: true,
      lostAt: true,
      followUps: { select: { statusAfter: true } },
    },
    orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }],
  });

  const buckets = new Map<string, FunnelBucket>();
  const bucket = (
    sourceChannel: SourceChannel,
    campaign: string | null = null,
  ) => {
    const key = `${sourceChannel}\u0000${campaign ?? ''}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: FunnelBucket = {
      sourceChannel,
      campaign,
      leads: 0,
      contacted: 0,
      trialReserved: 0,
      attended: 0,
      converted: 0,
      lost: 0,
      registeredMembers: 0,
      firstVisits: 0,
      payingMemberIds: new Set(),
      paidOrders: 0,
      netGmvCents: 0,
      trainingMemberIds: new Set(),
      trainingNetGmvCents: 0,
    };
    buckets.set(key, created);
    return created;
  };
  const inPeriod = (value: Date | null) =>
    Boolean(value && value >= periodStart && value < periodEnd);
  const convertedAttribution = new Map<
    string,
    { sourceChannel: SourceChannel; campaign: string | null }
  >();
  for (const lead of leads) {
    if (
      lead.convertedMemberId &&
      !convertedAttribution.has(lead.convertedMemberId)
    ) {
      convertedAttribution.set(lead.convertedMemberId, {
        sourceChannel: lead.sourceChannel,
        campaign: lead.campaign,
      });
    }
    if (!inPeriod(lead.createdAt)) continue;
    const leadTargets = [bucket(lead.sourceChannel)];
    if (lead.campaign)
      leadTargets.push(bucket(lead.sourceChannel, lead.campaign));
    const observedStatuses = new Set<LeadStatus>([
      lead.status,
      ...lead.followUps.map((item) => item.statusAfter),
    ]);
    const wasConverted = Boolean(lead.convertedAt);
    const wasLost = Boolean(lead.lostAt);
    if (wasConverted) {
      observedStatuses.add(LeadStatus.CONTACTING);
      observedStatuses.add(LeadStatus.TRIAL_RESERVED);
      observedStatuses.add(LeadStatus.ATTENDED);
    } else if (lead.status === LeadStatus.ATTENDED) {
      observedStatuses.add(LeadStatus.CONTACTING);
      observedStatuses.add(LeadStatus.TRIAL_RESERVED);
    } else if (lead.status === LeadStatus.TRIAL_RESERVED) {
      observedStatuses.add(LeadStatus.CONTACTING);
    }
    for (const target of leadTargets) {
      target.leads += 1;
      if (observedStatuses.has(LeadStatus.CONTACTING)) target.contacted += 1;
      if (observedStatuses.has(LeadStatus.TRIAL_RESERVED))
        target.trialReserved += 1;
      if (observedStatuses.has(LeadStatus.ATTENDED)) target.attended += 1;
      if (wasConverted) target.converted += 1;
      if (wasLost) target.lost += 1;
    }
  }
  for (const member of members) {
    const attribution = convertedAttribution.get(member.userId) ?? {
      sourceChannel: member.sourceChannel,
      campaign: null,
    };
    const targets = [bucket(attribution.sourceChannel)];
    if (attribution.campaign)
      targets.push(bucket(attribution.sourceChannel, attribution.campaign));
    for (const target of targets) {
      if (inPeriod(member.createdAt)) target.registeredMembers += 1;
      if (inPeriod(member.firstVisitAt)) target.firstVisits += 1;
    }
  }
  for (const order of orders) {
    const attribution = convertedAttribution.get(order.memberId) ?? {
      sourceChannel: order.sourceChannel,
      campaign: null,
    };
    const netAmount = Math.max(0, order.paidCents - order.refundedCents);
    const targets = [bucket(attribution.sourceChannel)];
    if (attribution.campaign)
      targets.push(bucket(attribution.sourceChannel, attribution.campaign));
    for (const target of targets) {
      target.payingMemberIds.add(order.memberId);
      target.paidOrders += 1;
      target.netGmvCents += netAmount;
      if (order.businessType === BusinessType.TRAINING) {
        target.trainingMemberIds.add(order.memberId);
        target.trainingNetGmvCents += netAmount;
      }
    }
  }

  const view = (item: FunnelBucket) => ({
    sourceChannel: item.sourceChannel,
    ...(item.campaign === null
      ? {}
      : { campaign: item.campaign || '未标记活动' }),
    leads: item.leads,
    contacted: item.contacted,
    trialReserved: item.trialReserved,
    attended: item.attended,
    converted: item.converted,
    lost: item.lost,
    registeredMembers: item.registeredMembers,
    firstVisits: item.firstVisits,
    payingCustomers: item.payingMemberIds.size,
    paidOrders: item.paidOrders,
    netGmvCents: item.netGmvCents,
    trainingCustomers: item.trainingMemberIds.size,
    trainingNetGmvCents: item.trainingNetGmvCents,
    leadToVisitRate: item.leads
      ? Math.round((item.firstVisits / item.leads) * 10_000) / 100
      : 0,
    leadToPaidRate: item.leads
      ? Math.round((item.payingMemberIds.size / item.leads) * 10_000) / 100
      : 0,
    leadToTrainingRate: item.leads
      ? Math.round((item.trainingMemberIds.size / item.leads) * 10_000) / 100
      : 0,
  });
  const values = [...buckets.values()];
  return {
    period: { start: periodStart, end: periodEnd },
    privacy: 'AGGREGATED_NO_PII',
    sources: values
      .filter((item) => item.campaign === null)
      .map(view)
      .sort((left, right) => right.netGmvCents - left.netGmvCents),
    campaigns: values
      .filter((item) => item.campaign !== null)
      .map(view)
      .sort((left, right) => right.netGmvCents - left.netGmvCents),
  };
}
