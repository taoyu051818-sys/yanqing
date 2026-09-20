/** Shared UI policy; the API rechecks the actor before executing every command. */
export const canExecuteDirectly = (roles: readonly string[]) =>
  roles.some(role => role === 'ADMIN' || role === 'SUPER_ADMIN')
