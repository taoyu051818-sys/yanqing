import { expect, it } from 'vitest';
import { nextYouthRule, youthRuleState } from './rule-status';
import type { YouthTrainingRuleView } from '../../../../types/training-operations';
const now = Date.parse('2026-09-23T10:00:00Z');
const rule = { status: 'PUBLISHED', effectiveFrom: '2026-09-24T01:00:00Z', effectiveTo: null } as YouthTrainingRuleView;
it('distinguishes a saved future rule from an active rule and selects the nearest scheduled rule', () => {
  expect(youthRuleState(rule, now)).toBe('已发布 · 待生效');
  expect(youthRuleState(rule, Date.parse(rule.effectiveFrom))).toBe('使用中');
  expect(nextYouthRule([{ ...rule, effectiveFrom: '2026-09-25T01:00:00Z' }, rule], now)).toBe(rule);
  expect(youthRuleState({ ...rule, status: 'SUPERSEDED', effectiveFrom: '2026-09-22T01:00:00Z', effectiveTo: '2026-09-24T01:00:00Z' }, now)).toBe('使用中');
});
