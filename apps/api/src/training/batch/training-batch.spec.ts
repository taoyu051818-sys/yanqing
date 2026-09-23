import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppRole } from '../../generated/prisma/enums.js';
import { ROLES_KEY } from '../../common/auth/auth.decorators.js';
import { TrainingBatchController } from './training-batch.controller.js';
import { TrainingBatchService } from './training-batch.service.js';
import { TrainingBatchDto } from './training-batch.dto.js';
const actor = { sub: 'admin-1', displayName: '管理员', roles: [AppRole.ADMIN] };
const dto = {
  items: ['a', 'b', 'c'].map((enrollmentId) => ({
    enrollmentId,
    idempotencyKey: `stable-key-${enrollmentId}`,
  })),
};
function setup() {
  const attendance = { markAttendance: vi.fn() },
    consumption = {
      proposeConsume: vi.fn(),
      confirmConsume: vi.fn(),
      consume: vi.fn(),
    };
  return {
    attendance,
    consumption,
    service: new TrainingBatchService(
      attendance as never,
      consumption as never,
    ),
  };
}
it('returns individual failures while executing other students and preserves confirmation keys', async () => {
  const { service, consumption } = setup();
  consumption.confirmConsume
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new ConflictException('退款处理中'))
    .mockResolvedValueOnce({});
  expect(await service.execute('lesson', 'confirmation', dto, actor)).toEqual({
    results: [
      { enrollmentId: 'a', status: 'SUCCEEDED' },
      { enrollmentId: 'b', status: 'FAILED', message: '退款处理中' },
      { enrollmentId: 'c', status: 'SUCCEEDED' },
    ],
  });
  expect(consumption.confirmConsume).toHaveBeenCalledTimes(3);
  expect(consumption.confirmConsume.mock.calls[1]).toEqual([
    'lesson',
    expect.objectContaining({
      enrollmentId: 'b',
      idempotencyKey: 'stable-key-b',
    }),
    actor,
    { allowHistoricalOverride: false },
  ]);
  await service.execute(
    'lesson',
    'confirmation',
    { items: [dto.items[1]] },
    actor,
  );
  expect(consumption.confirmConsume.mock.calls[3][1].idempotencyKey).toBe(
    'stable-key-b',
  );
});
it('never routes a coach proposal through the administrator posting dispatcher', async () => {
  const { service, consumption } = setup();
  await service.execute('lesson', 'proposal', dto, actor);
  expect(consumption.proposeConsume).toHaveBeenCalledTimes(3);
  expect(consumption.confirmConsume).not.toHaveBeenCalled();
  expect(consumption.consume).not.toHaveBeenCalled();
});
it('requires domain authorization and does not treat generated notes as historical override evidence', async () => {
  const { service, attendance } = setup();
  attendance.markAttendance.mockRejectedValue(
    new ForbiddenException('不属于此教练'),
  );
  const result = await service.execute('lesson', 'attendance', dto, actor);
  expect(result.results.every((row) => row.status === 'FAILED')).toBe(true);
  expect(attendance.markAttendance).toHaveBeenCalledWith(
    'lesson',
    expect.objectContaining({ status: 'ATTENDED' }),
    actor,
    { allowHistoricalOverride: false },
  );
});
it('rejects empty, oversized and duplicate batches before any mutation', async () => {
  const { service, consumption } = setup();
  for (const items of [
    [],
    [dto.items[0], dto.items[0]],
    Array.from({ length: 51 }, (_, i) => ({
      ...dto.items[0],
      enrollmentId: String(i),
    })),
  ])
    await expect(
      service.execute('lesson', 'confirmation', { items }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  expect(consumption.confirmConsume).not.toHaveBeenCalled();
});
it('redacts unexpected per-item infrastructure errors', async () => {
  const { service, consumption } = setup();
  consumption.confirmConsume.mockRejectedValue(
    new Error('database internal details'),
  );
  const result = await service.execute('lesson', 'confirmation', dto, actor);
  expect(JSON.stringify(result)).not.toContain('database internal');
});
it('keeps role boundaries on every bulk route', () => {
  expect(
    Reflect.getMetadata(
      ROLES_KEY,
      TrainingBatchController.prototype.confirmation,
    ),
  ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  expect(
    Reflect.getMetadata(ROLES_KEY, TrainingBatchController.prototype.proposal),
  ).toEqual([AppRole.COACH]);
  expect(
    Reflect.getMetadata(
      ROLES_KEY,
      TrainingBatchController.prototype.attendance,
    ),
  ).not.toContain(AppRole.MEMBER);
});
it('validates nested keys and malformed item arrays', async () => {
  for (const value of [
    { items: [null] },
    { items: [{ enrollmentId: 'a', idempotencyKey: 'x' }] },
    { items: [dto.items[0], dto.items[0]] },
  ])
    expect(
      (await validate(plainToInstance(TrainingBatchDto, value))).length,
    ).toBeGreaterThan(0);
  expect(await validate(plainToInstance(TrainingBatchDto, dto))).toEqual([]);
});
