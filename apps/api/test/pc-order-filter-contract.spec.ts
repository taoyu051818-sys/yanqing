import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { expect, it } from 'vitest';
import { OrderQueryDto } from '../src/orders/orders.dto.js';

it('every status offered by the PC order filter is accepted by the real order query DTO', () => {
  const component = readFileSync(
    new URL('../../admin/src/App.vue', import.meta.url),
    'utf8',
  );
  const source = component.match(/v-for="s in (\[[\s\S]*?\])"/);
  expect(
    source,
    'The actual order select must expose its status options',
  ).not.toBeNull();
  const statuses = JSON.parse(
    source![1].replaceAll("'", '"').replace(/,\s*\]/, ']'),
  ) as string[];
  expect(statuses).toContain('PENDING');
  for (const status of statuses) {
    const query = plainToInstance(OrderQueryDto, {
      status,
      page: 1,
      pageSize: 20,
    });
    expect(
      validateSync(query),
      `PC status ${status} must be accepted by the API`,
    ).toEqual([]);
  }
});
