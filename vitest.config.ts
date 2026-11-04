import { defineConfig } from 'vitest/config';

// The database tests share one test database, so test files run one after another.
export default defineConfig({ test: { fileParallelism: false } });
