import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: '/tmp/entity-browser-results',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.ENTITY_BASE_URL || 'http://127.0.0.1:5177',
    viewport: { width: 1440, height: 960 },
    headless: true,
    launchOptions: {
      executablePath: process.env.BROWSER_EXECUTABLE || undefined,
      chromiumSandbox: true,
    },
  },
});
