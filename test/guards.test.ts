// The guards run against xterm's real parser (the headless build shares its code).
import { Terminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { guardCountedSequences } from '../src/guards';

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));
const screen = (term: Terminal) => {
	const b = term.buffer.active;
	return Array.from({ length: term.rows }, (_, i) => b.getLine(b.baseY + i)?.translateToString(true) ?? '');
};

function make() {
	const term = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
	guardCountedSequences(term);
	return term;
}

describe('guardCountedSequences', () => {
	it('drops counts that would keep xterm busy for minutes', async () => {
		const term = make();
		const t0 = Date.now();
		for (const seq of ['\u001b[2000000000S', '\u001b[2000000000T', '\u001b[2000000000L', '\u001b[2000000000M', '\u001b[2000000000I', '\u001b[2000000000Z', 'a\u001b[2147483647b']) {
			await write(term, seq);
		}
		expect(Date.now() - t0).toBeLessThan(500);
		// The terminal still works afterwards.
		await write(term, '\r\nstill alive');
		expect(screen(term).some((l) => l.includes('still alive'))).toBe(true);
	});

	it('leaves normal counts alone', async () => {
		const term = make();
		await write(term, 'one\r\ntwo\r\nthree\u001b[H\u001b[2M');
		expect(screen(term)[0]).toBe('three');
		await write(term, '\u001b[Hx\u001b[4b');
		expect(screen(term)[0].startsWith('xxxxx')).toBe(true);
		await write(term, '\u001b[H\u001b[2I*');
		expect(screen(term)[0].indexOf('*')).toBe(16);
	});
});
