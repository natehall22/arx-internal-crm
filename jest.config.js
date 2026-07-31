const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^d3-contour$': '<rootDir>/node_modules/d3-contour/dist/d3-contour.js',
    '^d3-array$': '<rootDir>/node_modules/d3-array/dist/d3-array.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.claude/', '/.worktrees/'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)
