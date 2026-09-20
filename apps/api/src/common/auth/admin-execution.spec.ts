import { describe, it, expect } from 'vitest';
import { canExecuteDirectly, directExecutionKey } from './admin-execution.js';
import type { AuthUser } from './auth-user.js';
describe('administrator execution policy', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'])(
    'recognizes %s even alongside a member role',
    (role) => {
      expect(canExecuteDirectly({ roles: ['MEMBER', role] } as AuthUser)).toBe(
        true,
      );
    },
  );
  it.each(['MEMBER', 'FRONT_DESK', 'FINANCE', 'COACH', 'EVENT_MANAGER'])(
    'does not grant direct execution to %s',
    (role) => {
      expect(canExecuteDirectly({ roles: [role] } as AuthUser)).toBe(false);
    },
  );
  it('uses bounded stable phase-specific recovery keys without exposing the supplied identity', () => {
    const key = directExecutionKey('submit', 'original-command');
    expect(key).toHaveLength(71);
    expect(key).toBe(directExecutionKey('submit', 'original-command'));
    expect(key).not.toBe(directExecutionKey('confirm', 'original-command'));
    expect(key).not.toBe(directExecutionKey('submit', 'different-command'));
    expect(key).not.toContain('original-command');
  });
});
