import { defineConfig } from 'vitest/config'

// Emulator tests for the Cloud Functions handlers (run inside `firebase emulators:exec`).
export default defineConfig({
  test: {
    include: ['functions/test/**/*.test.js'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
