import { createHash } from 'node:crypto';
import type { AuthUser } from './auth-user.js';
/** Highest operational roles may execute their own commands; employee review rules remain. */
export const canExecuteDirectly = (actor: Pick<AuthUser, 'roles'>) =>
  actor.roles.some((role) => role === 'ADMIN' || role === 'SUPER_ADMIN');
/** Stable, bounded key for each internal phase of one operator command. */
export const directExecutionKey = (operation: string, identity: string) =>
  'DIRECT:' +
  createHash('sha256').update(`${operation}\0${identity}`).digest('hex');
