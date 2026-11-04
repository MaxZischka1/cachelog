/** Pure-logic tests only (core, db/memoryStore, import parsers). UI is checked by tsc. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, target: 'ES2022', module: 'commonjs', isolatedModules: true }, diagnostics: false }] },
};
