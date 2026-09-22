import { describe, expect, it } from 'vitest';
import { includesYouthAudience, isYouthEnrollment, trainingAudienceLabel } from './training-contract.js';
describe('mixed training audience', () => {
  it('labels and advertises mixed courses for both groups', () => {
    expect(trainingAudienceLabel('ALL')).toBe('不限');
    expect(includesYouthAudience('ALL')).toBe(true);
    expect(includesYouthAudience('ADULT')).toBe(false);
  });
  it.each([
    ['ADULT', null, false], ['YOUTH', 'child', true], ['YOUTH', null, true],
    ['ALL', null, false], ['ALL', 'child', true],
  ] as const)('classifies %s / %s by its actual learner', (audience, studentId, youth) => {
    expect(isYouthEnrollment({ product: { audience }, studentId })).toBe(youth);
  });
});
