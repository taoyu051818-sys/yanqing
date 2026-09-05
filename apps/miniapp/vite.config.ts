import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const remote = (process.env.VITE_DATA_MODE ?? env.VITE_DATA_MODE) === 'remote';
  const disabledMock = '\0yanqing:disabled-mock';
  return {
    base: process.env.VITE_PUBLIC_BASE_PATH || "/",
    plugins: [
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
