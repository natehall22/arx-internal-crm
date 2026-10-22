import { defineConfig, devices } from '@playwright/test'

/**
 * Mobile checks (e2e/mobile.spec.ts): every new/changed screen at iPhone SE and iPhone 13 sizes.
 * Runs against a local dev server with NO Supabase env (middleware lets it through) and mocked /api calls.
 * npm run test:mobile
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3111', trace: 'off' },
  projects: [
    { name: 'iphone-se', use: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 }, browserName: 'chromium' } },
    { name: 'iphone-13', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=harness-anon-key npx next dev -p 3111',
    url: 'http://localhost:3111/dev-harness/needs-you',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
