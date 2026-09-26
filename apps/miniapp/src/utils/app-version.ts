export type BuildIdentity = {
  version: string;
  commit: string;
  builtAt: string;
  dataMode: 'remote' | 'mock';
  apiBase: string;
  dirty: boolean;
};
export const appBuild: BuildIdentity = typeof __APP_RELEASE__ === 'undefined'
  ? { version: '本地开发', commit: '', builtAt: '', dataMode: 'mock', apiBase: '', dirty: true }
  : __APP_RELEASE__;

type PlatformVersion = { version?: string; envVersion?: string };
export function describeAppVersion(build: BuildIdentity, platform?: PlatformVersion) {
  const environment = build.dataMode === 'mock' ? '本地演示'
    : ({ develop: '开发版', trial: '体验版', release: '正式版' } as Record<string, string>)[platform?.envVersion || ''] || '开发预览';
  const installed = platform?.version?.trim();
  return {
    version: installed || build.version,
    environment,
    // A manually uploaded package can have a different platform version.
    // Preserve both identities rather than claiming the source build is newer.
    buildVersion: build.version,
    versionMismatch: Boolean(installed && installed !== build.version),
    revision: build.commit ? build.commit.slice(0, 7) + (build.dirty ? ' · 本地修改' : '') : '本地开发',
  };
}

export function readAppVersion() {
  let platform: PlatformVersion | undefined;
  try { platform = uni.getAccountInfoSync?.().miniProgram; } catch { /* H5 has no WeChat account API. */ }
  return describeAppVersion(appBuild, platform);
}

export function checkServiceConnection(): Promise<string> {
  if (appBuild.dataMode !== 'remote') return Promise.reject(new Error('当前为本地演示，不连接线上服务。'));
  return new Promise((resolve, reject) => uni.request({
    url: `${appBuild.apiBase}/health/ready`,
    method: 'GET', timeout: 10000,
    success: response => {
      const body = response.data as { code?: number; data?: { status?: string; revision?: string; checks?: { database?: string } } };
      if (response.statusCode === 200 && body.code === 0 && body.data?.status === 'ok' && body.data.checks?.database === 'ok') {
        resolve(body.data.revision || '');
      } else reject(new Error('服务暂时未就绪，请稍后重试。'));
    },
    fail: () => reject(new Error('连接失败，请检查网络后重试。')),
  }));
}
