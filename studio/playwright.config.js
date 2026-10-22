import { defineConfig, devices } from '@playwright/test';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['json', { outputFile: 'tests/e2e/.report.json' }]],
  use: {
    baseURL: 'http://localhost:4180',
    launchOptions: {
      executablePath: process.env.SS_BROWSER || EDGE,
      args: ['--force-device-scale-factor=1', '--hide-scrollbars']
    },
    viewport: { width: 1600, height: 1000 },
    trace: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4180',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
