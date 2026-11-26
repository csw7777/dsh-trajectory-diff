import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/diff.ts', 'src/otel.ts'],
  outDir: 'lib',
  format: 'esm',
  sourcemap: true,
  dts: false,
  clean: true,
  outExtensions: () => ({ js: '.js' }),
  external: [/^@deepseek-ai\//],
})
