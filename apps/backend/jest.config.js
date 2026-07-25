/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!generated/**'],
  coverageDirectory: '../coverage',
  // The generated Prisma clients are large and have nothing to test.
  modulePathIgnorePatterns: ['<rootDir>/generated'],
};
