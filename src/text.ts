// Text helpers shared by the banner, the paste filter and drag & drop.
// Everything here is pure so it can be unit tested without Obsidian.

/** C0 controls, DEL and C1 controls. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidirectional overrides/isolates: they can make text look different from what it is. */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;
/** Same as CONTROL_CHARS but keeps tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const PASTE_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * Makes an untrusted string (a folder or vault name) safe to write into the terminal
 * as display text: no escape sequences, no line breaks, no bidi tricks.
 */
export function sanitizeForDisplay(value: string): string {
	return value.replace(CONTROL_CHARS, '').replace(BIDI_CONTROLS, '');
}

/**
 * Filters text that is about to be pasted into the shell. Removing ESC is what
 * matters most: it stops a pasted `ESC[201~` from ending bracketed paste mode early
 * and running the rest of the clipboard as typed commands.
 */
export function sanitizePaste(value: string): string {
	return value.replace(PASTE_UNSAFE, '').replace(BIDI_CONTROLS, '');
}

export type QuoteFlavor = 'posix' | 'fish' | 'csh' | 'elvish' | 'nu';

/** How the shell named `name` (e.g. "zsh", "fish") reads quoted words. */
export function quoteFlavor(name: string): QuoteFlavor {
	if (name === 'fish') return 'fish';
	if (name === 'tcsh' || name === 'csh') return 'csh';
	if (name === 'elvish') return 'elvish';
	if (name === 'nu') return 'nu';
	return 'posix';
}

/**
 * Quotes a path so the shell reads it back as one literal word.
 * - posix (zsh, bash, sh, ksh, dash): everything inside '…' is literal.
 * - fish: also escapes \\ and \' inside '…'.
 * - csh/tcsh: '…' still expands !history, so ! is escaped outside the quotes.
 * - elvish: '' stands for a quote inside '…'.
 * - nu: "…" with \\ and \" escaped.
 * Returns null for names with control or bidi characters: they can't be typed
 * safely, and dropping them would silently name a different file.
 */
export function quoteForShell(value: string, flavor: QuoteFlavor = 'posix'): string | null {
	if (value.length === 0 || new RegExp(CONTROL_CHARS.source).test(value) || new RegExp(BIDI_CONTROLS.source).test(value)) return null;
	if (/^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/.test(value)) return value;
	switch (flavor) {
		case 'fish':
			return `'${value.replace(/[\\']/g, (c) => '\\' + c)}'`;
		case 'csh':
			return `'${value.replace(/'/g, `'\\''`).replace(/!/g, `'\\!'`)}'`;
		case 'elvish':
			return `'${value.replace(/'/g, "''")}'`;
		case 'nu':
			return `"${value.replace(/[\\"]/g, (c) => '\\' + c)}"`;
		default:
			return `'${value.replace(/'/g, `'\\''`)}'`;
	}
}

/** Longest run of combining marks kept on one character of terminal output. */
export const MAX_OUTPUT_MARKS = 16;

/**
 * Shortens runs of combining marks ("Zalgo" text). A terminal piles them all onto
 * one cell, and every redraw of that cell gets slower: a few megabytes of marks
 * would make the terminal, and Obsidian with it, crawl. `carry` is the length of
 * the run at the end of the previous chunk, so a run split across chunks counts once.
 */
export function capCombiningMarks(data: string, carry = 0, max = MAX_OUTPUT_MARKS): { text: string; carry: number } {
	if (!/\p{M}/u.test(data)) return { text: data, carry: 0 };
	let trailing = 0;
	const text = data.replace(/\p{M}+/gu, (marks: string, offset: number) => {
		const before = offset === 0 ? carry : 0;
		const chars = Array.from(marks);
		if (offset + marks.length === data.length) trailing = before + chars.length;
		const keep = Math.max(0, max - before);
		return chars.length > keep ? chars.slice(0, keep).join('') : marks;
	});
	return { text, carry: trailing };
}

/** What ⌘-click on a link in the terminal opens, or why it doesn't. */
export type LinkCheck = { open: true; href: string; label: string } | { open: false; label: string };

/**
 * Only http(s) links open. The label leads with the real host in ASCII (punycode),
 * so look-alike letters and long padding can't hide where a link goes, and links
 * with a user name or password (`https://bank.com@evil.example`) are refused.
 */
export function checkLink(uri: string): LinkCheck {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return { open: false, label: 'Not a valid link' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return { open: false, label: `Not opened: ${sanitizeForDisplay(url.protocol)} links` };
	if (url.username || url.password) return { open: false, label: `Not opened: this link hides its real address, ${url.host}` };
	const rest = truncateToWidth(sanitizeForDisplay(url.pathname + url.search + url.hash), 120);
	return { open: true, href: url.href, label: `${url.protocol}//${url.host}${rest === '/' ? '' : rest}` };
}

/** Display width of a code point in a terminal cell grid (0, 1 or 2). */
export function charWidth(cp: number): number {
	if (cp === 0) return 0;
	// Combining marks and zero-width characters.
	if (
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) ||
		(cp >= 0xfe20 && cp <= 0xfe2f) ||
		cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff
	) {
		return 0;
	}
	// East Asian wide/fullwidth ranges and emoji.
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0x303e) ||
		(cp >= 0x3041 && cp <= 0x33ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0x9fff) ||
		(cp >= 0xa000 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	) {
		return 2;
	}
	// Emoji drawn as pictures (🚀, ✅) take two cells, as in xterm's Unicode 11 tables.
	if (cp >= 0x231a && /\p{Emoji_Presentation}/u.test(String.fromCodePoint(cp))) return 2;
	return 1;
}

/** Display width of a plain (escape-free) string. */
export function displayWidth(value: string): number {
	let width = 0;
	for (const ch of value) width += charWidth(ch.codePointAt(0) ?? 0);
	return width;
}

/**
 * Shortens a plain string to at most `max` cells. Long paths keep their end,
 * which is the part that identifies the folder: `…/Projects/Ideas`.
 */
export function truncateToWidth(value: string, max: number, keepEnd = false): string {
	if (max <= 0) return '';
	if (displayWidth(value) <= max) return value;
	if (max === 1) return '…';
	const chars = Array.from(value);
	const out: string[] = [];
	let width = 1; // room for the ellipsis
	const source = keepEnd ? chars.reverse() : chars;
	for (const ch of source) {
		const w = charWidth(ch.codePointAt(0) ?? 0);
		if (width + w > max) break;
		out.push(ch);
		width += w;
	}
	return keepEnd ? '…' + out.reverse().join('') : out.join('') + '…';
}

/** Removes ANSI escape sequences, for measuring rendered lines in tests. */
export function stripAnsi(value: string): string {
	// eslint-disable-next-line no-control-regex -- strips escape sequences on purpose
	return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '');
}
