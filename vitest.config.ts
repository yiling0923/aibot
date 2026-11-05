import { defineConfig } from 'vitest/config';

// The database tests share one test database, so test files run one after another.
// Front end tests live next to the code (web/src/**/*.test.tsx). A test that needs a browser starts with the line: // @vitest-environment jsdom
export default defineConfig({
  test: { fileParallelism: false, include: ['test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'] },
});
