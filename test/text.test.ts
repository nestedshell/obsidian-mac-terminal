import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_MARKS, capCombiningMarks, checkLink, displayWidth, quoteFlavor, quoteForShell, sanitizeForDisplay, sanitizePaste, stripAnsi, truncateToWidth } from '../src/text';

describe('sanitizeForDisplay', () => {
	it('removes escape sequences, line breaks and bidi controls', () => {
		expect(sanitizeForDisplay('a\u001b]0;evil\u0007b')).toBe('a]0;evilb');
		expect(sanitizeForDisplay('line\r\nbreak\ttab')).toBe('linebreaktab');
		expect(sanitizeForDisplay('csi\u009b31m')).toBe('csi31m');
		expect(sanitizeForDisplay('abc‮dcba')).toBe('abcdcba');
	});
	it('keeps normal text, accents and emoji', () => {
		expect(sanitizeForDisplay('Idee nuove – àèìòù 你好 🎉')).toBe('Idee nuove – àèìòù 你好 🎉');
	});
});

describe('sanitizePaste', () => {
	it('strips ESC so a paste cannot end bracketed paste mode', () => {
		const attack = 'harmless\u001b[201~rm -rf ~\r';
		const clean = sanitizePaste(attack);
		expect(clean).not.toContain('\u001b');
		expect(clean).toBe('harmless[201~rm -rf ~\r');
	});
	it('keeps tabs and line breaks', () => {
		expect(sanitizePaste('a\tb\nc\r\nd')).toBe('a\tb\nc\r\nd');
	});
	it('strips other C0, DEL and C1 controls', () => {
		expect(sanitizePaste('a\u0000b\u0003c\u0004d\u007fe\u0085f\u009bg')).toBe('abcdefg');
	});
});

describe('quoteForShell', () => {
	it('leaves plain paths alone', () => {
		expect(quoteForShell('/Users/me/Vault/notes.md')).toBe('/Users/me/Vault/notes.md');
	});
	it('single-quotes anything with shell metacharacters', () => {
		expect(quoteForShell('/v/Idee nuove/a b.md')).toBe(`'/v/Idee nuove/a b.md'`);
		expect(quoteForShell('/v/$(rm -rf ~)`x`;|&<>*?[]{}!#~=%')).toBe(`'/v/$(rm -rf ~)\`x\`;|&<>*?[]{}!#~=%'`);
	});
	it('escapes single quotes for POSIX shells', () => {
		expect(quoteForShell(`/v/it's`)).toBe(`'/v/it'\\''s'`);
	});
	it('escapes backslashes and quotes for fish', () => {
		expect(quoteForShell(`/v/a\\'b`, 'fish')).toBe(`'/v/a\\\\\\'b'`);
	});
	it('quotes for tcsh, elvish and nu', () => {
		expect(quoteForShell(`/v/it's notes!!.md`, 'csh')).toBe(`'/v/it'\\''s notes'\\!''\\!'.md'`);
		expect(quoteForShell(`/v/it's`, 'elvish')).toBe(`'/v/it''s'`);
		expect(quoteForShell(`/v/a"b\\c`, 'nu')).toBe(`"/v/a\\"b\\\\c"`);
	});
	it('maps shell names to quoting rules', () => {
		expect(quoteFlavor('zsh')).toBe('posix');
		expect(quoteFlavor('bash')).toBe('posix');
		expect(quoteFlavor('fish')).toBe('fish');
		expect(quoteFlavor('tcsh')).toBe('csh');
		expect(quoteFlavor('nu')).toBe('nu');
		expect(quoteFlavor('xonsh')).toBe('posix');
	});
	it('refuses bidi marks instead of silently dropping them', () => {
		expect(quoteForShell('/v/report\u200f.pdf')).toBeNull();
		expect(quoteForShell('/v/\u202egnp.exe')).toBeNull();
	});
	it('refuses control characters', () => {
		expect(quoteForShell('/v/new\nline')).toBeNull();
		expect(quoteForShell('/v/\u001b[2J')).toBeNull();
		expect(quoteForShell('')).toBeNull();
	});
	it('quotes words that start with a dash or an equals sign', () => {
		expect(quoteForShell('-rf')).toBe(`'-rf'`);
		expect(quoteForShell('=ls')).toBe(`'=ls'`);
	});
});

describe('capCombiningMarks', () => {
	const marks = (n: number) => '\u0301'.repeat(n);
	it('keeps normal accents and scripts untouched', () => {
		const text = 'àèìòù e\u0301 नमस्ते Tiếng Việt';
		expect(capCombiningMarks(text).text).toBe(text);
	});
	it('shortens a huge run of marks on one character', () => {
		const out = capCombiningMarks('a' + marks(1_000_000) + 'b');
		expect(out.text).toBe('a' + marks(MAX_OUTPUT_MARKS) + 'b');
		expect(out.carry).toBe(0);
	});
	it('counts a run split across chunks once', () => {
		const first = capCombiningMarks('a' + marks(10));
		expect(first.carry).toBe(10);
		const second = capCombiningMarks(marks(100) + 'b', first.carry);
		expect(second.text).toBe(marks(MAX_OUTPUT_MARKS - 10) + 'b');
	});
});

describe('checkLink', () => {
	it('opens http(s) links and shows their host first', () => {
		expect(checkLink('https://obsidian.md/help?x=1#y')).toEqual({ open: true, href: 'https://obsidian.md/help?x=1#y', label: 'https://obsidian.md/help?x=1#y' });
	});
	it('refuses links that hide their host behind a user name', () => {
		const link = checkLink('https://accounts.google.com:' + 'signin'.repeat(40) + '@evil.example/login');
		expect(link.open).toBe(false);
		expect(link.label).toContain('evil.example');
	});
	it('shows look-alike hosts in punycode', () => {
		const link = checkLink('https://аррӏе.com/');
		expect(link).toMatchObject({ open: true, label: 'https://xn--80ak6aa92e.com' });
	});
	it('keeps the host visible however long the path is', () => {
		const link = checkLink('https://evil.example/' + 'a'.repeat(5000));
		expect(link.label.startsWith('https://evil.example/')).toBe(true);
		expect(link.label.length).toBeLessThan(200);
	});
	it('refuses other schemes and garbage', () => {
		expect(checkLink('file:///etc/passwd').open).toBe(false);
		expect(checkLink('javascript:alert(1)').open).toBe(false);
		expect(checkLink('not a url').open).toBe(false);
	});
});

describe('width helpers', () => {
	it('counts wide characters as two cells', () => {
		expect(displayWidth('🚀✅')).toBe(4);
		expect(displayWidth('abc')).toBe(3);
		expect(displayWidth('你好')).toBe(4);
		expect(displayWidth('🎉')).toBe(2);
		expect(displayWidth('é')).toBe(1);
	});
	it('truncates to the requested width', () => {
		expect(truncateToWidth('abcdef', 4)).toBe('abc…');
		expect(truncateToWidth('Progetti/Idee nuove', 10, true)).toBe('…dee nuove');
		expect(displayWidth(truncateToWidth('你好你好你好', 5))).toBeLessThanOrEqual(5);
		expect(truncateToWidth('abc', 3)).toBe('abc');
		expect(truncateToWidth('abc', 0)).toBe('');
	});
	it('stripAnsi removes CSI and OSC sequences', () => {
		expect(stripAnsi('\u001b[38;2;1;2;3mhi\u001b[0m \u001b]0;t\u0007x')).toBe('hi x');
	});
});
