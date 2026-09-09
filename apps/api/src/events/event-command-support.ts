import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

export const normaliseText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normaliseOptionalText = (value: unknown): string | undefined => {
  const text = normaliseText(value);
  return text || undefined;
};

export function assertCommandKey(value: string, label: string): void {
  if (value.length < 8 || value.length > 100) {
    throw new BadRequestException(`${label}长度必须为8-100个字符`);
  }
}
