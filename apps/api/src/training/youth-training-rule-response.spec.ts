import { describe, expect, it } from 'vitest';
import {
  youthTrainingRulePublicResponse,
  youthTrainingRuleManagementResponse,
} from './youth-training-rule-response.js';

const now = new Date('2026-09-10T01:00:00Z');
const rule = {
  id: 'rule',
  version: 'YTR-1',
  status: 'PUBLISHED' as const,
  maxTotalSessions: 20,
  maxValidityDays: 180,
  maxContractAmountCents: 300000,
  warningThresholdDays: 30,
  hardBlock: true,
  effectiveFrom: now,
  effectiveTo: null,
  requestReason: '按监管口径配置',
  reviewReason: null,
  reviewedAt: null,
  createdAt: now,
  updatedAt: now,
  requestedById: 'admin',
  requestIdempotencyKey: 'private-key',
  commandHash: 'private-hash',
};
describe('youth rule projection contract', () => {
  it('returns only public policy fields and serializes dates for the client', () => {
    const output = JSON.parse(
      JSON.stringify(youthTrainingRulePublicResponse(rule)),
    );
    expect(output).toEqual({
      id: 'rule',
      version: 'YTR-1',
      status: 'PUBLISHED',
      maxTotalSessions: 20,
      maxValidityDays: 180,
      maxContractAmountCents: 300000,
      warningThresholdDays: 30,
      hardBlock: true,
      effectiveFrom: now.toISOString(),
      effectiveTo: null,
    });
  });
  it('keeps actor ownership and display-name fallbacks without returning persistence metadata', () => {
    const output = youthTrainingRuleManagementResponse(
      { ...rule, requestedBy: { displayName: '  ' } },
      {
        actorId: 'admin',
        requestedByDisplayName: '制单人',
        reviewedByDisplayName: '复核人',
      },
    );
    expect(output).toMatchObject({
      isOwnRequester: true,
      requestedBy: { displayName: '制单人' },
      reviewedBy: { displayName: '复核人' },
      createdAt: now,
      reviewedAt: null,
    });
    for (const field of [
      'requestedById',
      'requestIdempotencyKey',
      'commandHash',
    ])
      expect(output).not.toHaveProperty(field);
    expect(
      youthTrainingRuleManagementResponse(rule, { actorId: 'another' })
        .isOwnRequester,
    ).toBe(false);
  });
});
