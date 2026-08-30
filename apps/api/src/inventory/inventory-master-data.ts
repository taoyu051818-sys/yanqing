import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException } from '@nestjs/common';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

export const inventoryCommandHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

export function normalizeMasterCommand(reasonValue: string, keyValue: string) {
  const reason = reasonValue.trim();
  const requestId = keyValue.trim();
  if (reason.length < 2 || reason.length > 300)
    throw new BadRequestException('变更原因长度必须为 2-300 个字符');
  if (requestId.length < 8 || requestId.length > 100)
    throw new BadRequestException('幂等键长度必须为 8-100 个字符');
  return { reason, requestId };
}

export function requireTrimmedField(
  value: string,
  label: string,
  minLength: number,
  maxLength: number,
) {
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength)
    throw new BadRequestException(
      `${label}长度必须为 ${minLength}-${maxLength} 个字符`,
    );
  return normalized;
}

export function assertMasterDataVersion(current: Date, expected: string) {
  const expectedDate = new Date(expected);
  if (
    Number.isNaN(expectedDate.getTime()) ||
    current.getTime() !== expectedDate.getTime()
  ) {
    throw new ConflictException('资料已被其他账号修改，请刷新后重试');
  }
}
