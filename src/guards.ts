// Protection against escape sequences that make the terminal do huge amounts of work
// (no Obsidian imports, so it can be tested with xterm's headless build).
import type { IDisposable } from '@xterm/xterm';

/** The part of an xterm Terminal the guards need. */
export interface GuardedTerminal {
	readonly rows: number;
	readonly cols: number;
	readonly parser: {
		registerCsiHandler(id: { final: string }, callback: (params: (number | number[])[]) => boolean): IDisposable;
	};
}

/**
 * A few escape sequences repeat their action as many times as the output asks, up
 * to two billion: `ESC[2000000000S` alone would freeze Obsidian for minutes. Counts
 * beyond what the screen can show have no extra visible effect and real programs
 * don't send them, so those sequences are dropped (a handler returning true).
 */
export function guardCountedSequences(term: GuardedTerminal): IDisposable[] {
	const count = (params: (number | number[])[]) => (typeof params[0] === 'number' && params[0] > 0 ? params[0] : 1);
	return [
		// Scroll up/down, insert/delete lines.
		...['S', 'T', 'L', 'M'].map((final) => term.parser.registerCsiHandler({ final }, (p) => count(p) > term.rows)),
		// Tab forward/back.
		...['I', 'Z'].map((final) => term.parser.registerCsiHandler({ final }, (p) => count(p) > term.cols)),
		// Repeat the last character.
		term.parser.registerCsiHandler({ final: 'b' }, (p) => count(p) > term.cols * term.rows),
	];
}
