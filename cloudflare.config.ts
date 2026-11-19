import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  accountId: '4df227652891f2f59399ce1b462fb720',
  worker: {
    name: 'vip-sales',
    entrypoint: './worker/index.mjs',
    compatibilityDate: '2026-11-19',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    previewUrls: false,
    env: {
      ASSETS: bindings.assets(),
    },
    assets: {
      runWorkerFirst: ['/api', '/api/*'],
    },
    observability: {
      enabled: true,
      traces: { enabled: true },
    },
  },
});
