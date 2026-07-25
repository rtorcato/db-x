import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Spinner, failNonInteractive, isInteractive, makeSpinner } from './tty.js'

// The TTY helpers underpin the CLI's behaviour when piped to a file, run in
// CI, or otherwise detached from a real terminal.

describe('isInteractive', () => {
	it('returns true when the stream has isTTY=true', () => {
		expect(isInteractive({ isTTY: true })).toBe(true)
	})

	it('returns false when the stream has isTTY=false', () => {
		expect(isInteractive({ isTTY: false })).toBe(false)
	})

	it('returns false when isTTY is undefined (Node pipes set it to undefined)', () => {
		expect(isInteractive({})).toBe(false)
	})
})

describe('makeSpinner', () => {
	// process.stdout.isTTY is captured by the imported module; the only way to
	// exercise both branches is to mutate the property in place and restore it.
	let logSpy: ReturnType<typeof vi.spyOn>
	let originalIsTTY: boolean | undefined

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		originalIsTTY = process.stdout.isTTY
	})

	afterEach(() => {
		logSpy.mockRestore()
		Object.defineProperty(process.stdout, 'isTTY', {
			value: originalIsTTY,
			configurable: true,
			writable: true,
		})
	})

	function setTTY(value: boolean): void {
		Object.defineProperty(process.stdout, 'isTTY', {
			value,
			configurable: true,
			writable: true,
		})
	}

	it('returns the real spinner when stdout is a TTY', () => {
		setTTY(true)
		const realSpinner: Spinner = {
			start: vi.fn(),
			stop: vi.fn(),
			message: vi.fn(),
		}
		const realSpinnerFactory = vi.fn(() => realSpinner)
		const s = makeSpinner(realSpinnerFactory)
		expect(realSpinnerFactory).toHaveBeenCalledTimes(1)
		expect(s).toBe(realSpinner)
	})

	it('returns a console-logging shim when stdout is not a TTY', () => {
		setTTY(false)
		const realSpinnerFactory = vi.fn()
		const s = makeSpinner(realSpinnerFactory)
		expect(realSpinnerFactory).not.toHaveBeenCalled()

		s.start('Loading')
		s.message('Half way')
		s.stop('Done')

		expect(logSpy).toHaveBeenNthCalledWith(1, 'Loading...')
		expect(logSpy).toHaveBeenNthCalledWith(2, 'Half way')
		expect(logSpy).toHaveBeenNthCalledWith(3, 'Done')
	})

	it('ignores the exit code arg on the non-TTY shim (clack accepts one)', () => {
		setTTY(false)
		const s = makeSpinner(vi.fn())
		s.stop('Failed', 1)
		expect(logSpy).toHaveBeenCalledWith('Failed')
	})
})

describe('failNonInteractive', () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>
	let exitSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
		// process.exit is typed as `never`; vi.spyOn can't directly mock that
		// without an explicit cast.
		exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			throw new Error(`exit:${code ?? 0}`)
		}) as never)
	})

	afterEach(() => {
		stderrSpy.mockRestore()
		exitSpy.mockRestore()
	})

	it('writes the prefixed message to stderr', () => {
		expect(() => failNonInteractive('boom')).toThrowError('exit:1')
		expect(stderrSpy).toHaveBeenCalledWith('db-x: boom\n')
	})

	it('exits with code 1', () => {
		expect(() => failNonInteractive('boom')).toThrowError('exit:1')
		expect(exitSpy).toHaveBeenCalledWith(1)
	})
})
