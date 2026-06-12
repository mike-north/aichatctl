/**
 * Root Jest config for the workspace.
 *
 * Uses ts-jest in ESM mode so tests can import the NodeNext ESM source directly.
 * Run via `pnpm test` (sets --experimental-vm-modules).
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  roots: ["<rootDir>/packages"],
  testMatch: ["**/src/**/*.test.ts"],
  moduleNameMapper: {
    // NodeNext source imports use explicit .js specifiers; map them back to .ts for ts-jest.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.jest.json",
      },
    ],
  },
};
