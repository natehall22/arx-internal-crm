// Optional: configure or set up a testing framework before each test.
// If you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// The app address every link is built from (lib/app-url.ts has no fallback host). Same placeholder CI sets
// (.github/workflows/ci.yml), so local gates and CI run the same; tests that need it missing delete it themselves.
if (!process.env.NEXT_PUBLIC_APP_URL) process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
