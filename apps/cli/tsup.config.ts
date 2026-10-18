import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // Core is private and ships as TypeScript source, so it is bundled into the CLI.
  noExternal: ['@ovd/core']
})
