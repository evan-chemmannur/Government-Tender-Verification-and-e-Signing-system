// jest.config.js
export default {
  testEnvironment: 'node',
  transform: {},                        // no transform — pure ESM
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches:   80,
      functions:  80,
      lines:      80,
      statements: 80,
    },
  },
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [],
  forceExit: true,
  maxWorkers: 1,       // pg-mem is not safe for parallel workers
};
