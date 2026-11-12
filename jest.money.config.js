// The money end-to-end suite: real server functions against a real local Postgres 16 (+ PostgREST). Run with `npm run test:money`
// (scripts/test-money.sh starts the database, builds it from production's schema + every newer migration, then runs this).
const nextJest = require('next/jest')
const createJestConfig = nextJest({ dir: './' })
module.exports = createJestConfig({
  testEnvironment: 'node',
  testMatch: ['<rootDir>/money-e2e/**/*.money.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1', '^server-only$': '<rootDir>/money-e2e/empty.js' },
  setupFiles: ['<rootDir>/money-e2e/env.js'],
  testTimeout: 120000,
  maxWorkers: 1,
})
