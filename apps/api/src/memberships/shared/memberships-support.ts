import { createHash, randomBytes } from 'node:crypto';

export const orderNo = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const commandHash = (command: Record<string, unknown>) =>
  createHash('sha256')
    .update(JSON.stringify({ version: 1, command }))
    .digest('hex');

export const isRetryableWriteConflict = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  ['P2002', 'P2034'].includes(String((error as { code?: unknown }).code));

export const rechargePlanView = <T extends Record<string, unknown>>(
  plan: T,
) => {
  const {
    creationIdempotencyKey: _creationIdempotencyKey,
    creationCommandHash: _creationCommandHash,
    ...view
  } = plan;
  return view;
};

export const rechargePlanTransitionView = <T extends Record<string, unknown>>(
  transition: T,
) => {
  const {
    idempotencyKey: _idempotencyKey,
    commandHash: _commandHash,
    plan: _plan,
    ...view
  } = transition;
  return view;
};

export const membershipProductView = <T extends Record<string, unknown>>(
  product: T,
) => {
  const {
    creationIdempotencyKey: _creationIdempotencyKey,
    creationCommandHash: _creationCommandHash,
    ...view
  } = product;
  return view;
};

export const membershipProductTransitionView = <
  T extends Record<string, unknown>,
>(
  transition: T,
) => {
  const {
    idempotencyKey: _idempotencyKey,
    commandHash: _commandHash,
    membershipProduct: _membershipProduct,
    ...view
  } = transition;
  return view;
};
