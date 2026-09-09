import { ConflictException } from '@nestjs/common';
import { YouthTrainingRulesService } from '../youth-training-rules.service.js';

export function validateYouthProduct(
  youthRules: YouthTrainingRulesService | undefined,
  input: {
    totalSessions: number;
    validityDays: number;
    priceCents: number;
  },
  at = new Date(),
) {
  if (!youthRules) {
    throw new ConflictException('青少年培训监管服务未加载，正式销售已安全阻断');
  }
  return youthRules.validateProduct(input, at);
}
