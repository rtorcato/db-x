import { defineConfig } from 'vitest/config'

export default defineConfig({
	esbuild: {
		jsx: 'automatic',
		jsxImportSource: '@db-x/runtime',
		jsxDev: false,
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.{test,spec}.{ts,mts,cts,tsx}'],
		exclude: ['**/node_modules/**', '**/dist/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.config.{js,ts}'],
		},
	},
})
