import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { createReleaseMetadata } from './scripts/release-metadata.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const remote = (process.env.VITE_DATA_MODE ?? env.VITE_DATA_MODE) === 'remote';
  const release = createReleaseMetadata({
    dataMode: remote ? 'remote' : 'mock',
    apiBase: process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3200/api/v1',
  });
  const disabledMock = '\0yanqing:disabled-mock';
  return {
    base: process.env.VITE_PUBLIC_BASE_PATH || "/",
    define: { __APP_RELEASE__: JSON.stringify(release) },
    plugins: [
      {
        name: 'yanqing-release-identity',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'release-info.json', source: JSON.stringify(release, null, 2) + '\n' });
        },
      },
      {
        name: 'yanqing-mock-build-boundary',
        enforce: 'pre',
        // uni-app can emit async dependency chunks before dead-code removal.
        // Select the adapter before resolving any mock modules or seed data.
        resolveId(id) {
          if (!['@miniapp/mock/router', '@miniapp/mock/state'].includes(id)) return null;
          const file = id.endsWith('/router') ? 'router.ts' : 'state.ts';
          return remote ? disabledMock : fileURLToPath(new URL('./src/services/mock/' + file, import.meta.url));
        },
        load(id) {
          if (id !== disabledMock) return null;
          return 'export function mockRequest(){throw new Error("Mock data is disabled in remote builds")};export function resetCatalogState(){throw new Error("Mock reset is disabled in remote builds")}';
        },
      },
      uni(),
    ],
  };
});
