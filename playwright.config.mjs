import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 40000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['json', { outputFile: 'qa/ui-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4818', channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node server/index.mjs --production', url: 'http://127.0.0.1:4818/api/config', timeout: 30000, reuseExistingServer: !process.env.CI },
});
