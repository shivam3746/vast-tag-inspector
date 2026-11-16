import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4178';
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  use: { baseURL, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'node e2e/server.ts',
    url: `${baseURL}/api/health`,
    timeout: 30_000,
  },
});
