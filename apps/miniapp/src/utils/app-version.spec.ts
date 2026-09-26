import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeAppVersion } from './app-version';
const build = { version: '1.0.11', commit: 'abcdef0123456789', builtAt: '', dataMode: 'remote' as const, apiBase: 'https://api.yutechhn.cn/api/v1', dirty: false };
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('installed application identity', () => {
  it('uses the actual platform version and preserves a differing source version', () => {
    const view = describeAppVersion(build, { version: '1.0.10', envVersion: 'trial' });
    expect(view).toMatchObject({ version: '1.0.10', buildVersion: '1.0.11', environment: '体验版', versionMismatch: true, revision: 'abcdef0' });
  });
  it('does not label a browser preview or mock package as the official release', () => {
    expect(describeAppVersion(build).environment).toBe('开发预览');
    expect(describeAppVersion({ ...build, dataMode: 'mock' }, { envVersion: 'release' }).environment).toBe('本地演示');
  });
  it('checks only public readiness without transmitting a login token', async () => {
    vi.stubGlobal('__APP_RELEASE__', build);
    const request = vi.fn(options => options.success({ statusCode: 200, data: { code: 0, data: { status: 'ok', revision: build.commit, checks: { database: 'ok' } } } }));
    vi.stubGlobal('uni', { request });
    const { checkServiceConnection } = await import('./app-version');
    await expect(checkServiceConnection()).resolves.toBe(build.commit);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'GET', timeout: 10000, url: build.apiBase + '/health/ready' });
    expect(request.mock.calls[0][0]).not.toHaveProperty('header');
  });
  it('does not report a failed database as a healthy service', async () => {
    vi.stubGlobal('__APP_RELEASE__', build);
    vi.stubGlobal('uni', { request: (options: any) => options.success({ statusCode: 200, data: { code: 0, data: { status: 'ok', checks: { database: 'failed' } } } }) });
    const { checkServiceConnection } = await import('./app-version');
    await expect(checkServiceConnection()).rejects.toThrow('暂时未就绪');
  });
  it('never connects to production from a local demo', async () => {
    vi.stubGlobal('__APP_RELEASE__', { ...build, dataMode: 'mock' });
    const request = vi.fn(); vi.stubGlobal('uni', { request });
    const { checkServiceConnection } = await import('./app-version');
    await expect(checkServiceConnection()).rejects.toThrow('本地演示');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects an empty readiness response with a retryable message', async () => {
    vi.stubGlobal('__APP_RELEASE__', build);
    let receive: (value: unknown) => void = () => {};
    vi.stubGlobal('uni', { request: (options: any) => { receive = options.success; } });
    const { checkServiceConnection } = await import('./app-version');
    const pending = checkServiceConnection();
    const assertion = expect(pending).rejects.toThrow('暂时未就绪');
    // The real callback arrives after the Promise executor has returned.
    expect(() => receive({ statusCode: 200, data: null })).not.toThrow();
    await assertion;
  });
});
