import {
  ConflictException,
  InternalServerErrorException,
  type ArgumentsHost,
} from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
it('transports a business code independently of its translated display message', () => {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ requestId: 'req' }),
    }),
  } as ArgumentsHost;
  new AllExceptionsFilter().catch(
    new ConflictException({
      message: '新的提示文案',
      businessCode: 'COURT_REVISION_CONFLICT',
    }),
    host,
  );
  expect(response.json).toHaveBeenCalledWith({
    code: 409,
    message: '新的提示文案',
    businessCode: 'COURT_REVISION_CONFLICT',
    data: null,
    requestId: 'req',
  });
  new AllExceptionsFilter().catch(
    new InternalServerErrorException({
      message: 'internal',
      businessCode: 'PRIVATE',
    }),
    host,
  );
  expect(response.json).toHaveBeenLastCalledWith({
    code: 500,
    message: '服务器内部错误',
    data: null,
    requestId: 'req',
  });
});
