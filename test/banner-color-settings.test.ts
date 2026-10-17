import { describe, expect, it } from 'vitest';
import { ART_WIDTH, renderBanner, renderOctopus, WIDE_LAYOUT_MIN_COLS } from '../src/banner';
import { contrast, isDark, isHexColor, parseColor, toCss, toHex, BLACK, WHITE } from '../src/color';
import { cleanFontFamily } from '../src/theme';
import { BACKGROUNDS, DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, effectiveBackground, sanitizeSettings } from '../src/settings-data';
import { displayWidth, stripAnsi } from '../src/text';

const accent = { r: 138, g: 92, b: 245, a: 1 };
const info = (cols: number, extra: Partial<Parameters<typeof renderBanner>[0]> = {}) => ({
	cols,
	rows: 40,
	accent,
	version: '1.0.0',
	vault: 'Second Brain',
	folder: 'Progetti/Idee nuove',
	shell: 'zsh (login)',
	system: 'macOS 27.0 · Apple silicon',
	...extra,
});

describe('renderBanner', () => {
	it('never writes a line wider than the terminal', () => {
		for (let cols = 1; cols <= 160; cols++) {
			for (const rows of [5, 13, 14, 40]) {
				for (const project of [undefined, { name: 'Un progetto con un nome davvero molto lungo 你好🎉', color: { r: 233, g: 49, b: 71, a: 1 } }]) {
					const lines = stripAnsi(renderBanner(info(cols, { rows, project, folder: 'Molto/lunga/cartella/con/nome/lunghissimo/你好🎉' }))).split('\r\n');
					for (const line of lines) expect(displayWidth(line), `cols=${cols} rows=${rows} "${line}"`).toBeLessThan(cols);
				}
			}
		}
	});
	it('is empty when the terminal is too narrow', () => {
		expect(renderBanner(info(7))).toBe('');
		expect(renderBanner(info(Number.NaN))).toBe('');
	});
	it('shows the gem only when there is room', () => {
		const gem = '\u001b[48;2;'; // the gem is drawn with background colours
		expect(renderBanner(info(WIDE_LAYOUT_MIN_COLS))).toContain(gem);
		expect(renderBanner(info(WIDE_LAYOUT_MIN_COLS - 1))).not.toContain(gem);
		expect(renderBanner(info(120, { rows: 10 }))).not.toContain(gem);
		expect(renderBanner(info(100))).not.toContain('✦');
	});
	it('cannot be used to inject escape sequences', () => {
		const out = renderBanner(info(100, { vault: 'v\u001b]52;c;ZXZpbA==\u0007', folder: 'f\u001b[6n\r\nrm -rf ~', shell: 's\u009b0c' }));
		expect(out).not.toContain('\u001b]52');
		expect(out).not.toContain('\u001b[6n');
		expect(out).not.toContain('\u009b');
		expect(out).not.toMatch(/\r\nrm -rf/);
	});
	it('shows the project name and its dot, in both layouts', () => {
		const red = { r: 233, g: 49, b: 71, a: 1 };
		const wide = renderBanner(info(100, { project: { name: 'App iOS', color: red } }));
		expect(stripAnsi(wide)).toMatch(/project\s+● App iOS/);
		expect(wide).toContain('\u001b[38;2;233;49;71m●');
		expect(stripAnsi(wide)).toContain('folder');
		const compact = stripAnsi(renderBanner(info(40, { project: { name: 'App iOS', color: null } })));
		expect(compact).toContain('◆ App iOS');
		expect(compact).toContain('Idee nuove');
		expect(stripAnsi(renderBanner(info(100)))).not.toContain('project');
	});
	it('credits nestedshell and draws a rule as long as the panel', () => {
		const lines = stripAnsi(renderBanner(info(100))).split('\r\n').map((l) => l.slice(2 + ART_WIDTH + 3));
		const title = lines.findIndex((l) => l.startsWith('mac-terminal v1.0.0'));
		expect(lines[title + 1].trim()).toBe('by nestedshell');
		const rule = lines[title + 2].trim();
		expect(rule).toMatch(/^─+$/);
		expect(rule.length).toBe(Math.max(...lines.filter((l) => /^(vault|folder|shell|system) /.test(l)).map((l) => displayWidth(l.trimEnd()))));
		expect(stripAnsi(renderBanner(info(45)))).toContain('mac-terminal v1.0.0  by nestedshell');
	});
	it('shows where a linked folder really is', () => {
		const out = stripAnsi(renderBanner(info(100, { folder: 'Projects/Linked', link: '/Users/me/code/app' })));
		expect(out).toMatch(/folder\s+Projects\/Linked/);
		expect(out).toMatch(/link to\s+\/Users\/me\/code\/app/);
	});
	it('has no colour swatches', () => {
		expect(renderBanner(info(100))).not.toMatch(/\u001b\[4[0-7]m/);
	});
	it('keeps the project name from injecting escape sequences', () => {
		const out = renderBanner(info(100, { project: { name: 'x\u001b]52;c;ZXZpbA==\u0007\u001b[2J', color: null } }));
		expect(out).not.toContain('\u001b]52');
		expect(out).not.toContain('\u001b[2J');
	});
	it('only emits SGR colour sequences', () => {
		// eslint-disable-next-line no-control-regex
		const sequences = renderBanner(info(100)).match(/\u001b\[[0-9;]*[A-Za-z]/g) ?? [];
		for (const seq of sequences) expect(seq.endsWith('m')).toBe(true);
	});
	it('draws the octopus as a block of whole cells', () => {
		const rows = renderOctopus().map(stripAnsi);
		expect(rows).toHaveLength(12);
		for (const row of rows) expect(displayWidth(row)).toBe(ART_WIDTH);
	});
	it('draws a ninja that reads on black and on white, so switching the background keeps it right', () => {
		// The body is the colour that fills most cells.
		const counts = new Map<string, number>();
		for (const m of renderOctopus().join('').matchAll(/\u001b\[48;2;(\d+);(\d+);(\d+)m/g)) counts.set(m.slice(1).join(','), (counts.get(m.slice(1).join(',')) ?? 0) + 1);
		const [r, g, b] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0].split(',').map(Number);
		const body = { r, g, b, a: 1 };
		expect(contrast(body, BLACK)).toBeGreaterThan(1.8);
		expect(contrast(body, WHITE)).toBeGreaterThan(7);
	});
});

describe('colors', () => {
	it('parses what computed styles return', () => {
		expect(parseColor('rgb(30, 30, 30)')).toEqual({ r: 30, g: 30, b: 30, a: 1 });
		expect(parseColor('rgba(138, 92, 245, 0.25)')).toEqual({ r: 138, g: 92, b: 245, a: 0.25 });
		expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
		expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
		expect(parseColor('#1e1e1e80')?.a).toBeCloseTo(0.5, 2);
		expect(parseColor('hsl(0 0% 0%)')).toBeNull();
		expect(parseColor('')).toBeNull();
	});
	it('formats and measures', () => {
		expect(toHex({ r: 255, g: 0, b: 16, a: 1 })).toBe('#ff0010');
		expect(toCss({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('rgba(0, 0, 0, 0.5)');
		expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 0);
		expect(isHexColor('#a0B1c2')).toBe(true);
		expect(isHexColor('red')).toBe(false);
		expect(isHexColor('#fff')).toBe(false);
	});
	it('keeps font names from breaking out of the stylesheet', () => {
		expect(cleanFontFamily('"Evil}body{display:none", Menlo')).toBe('Menlo, monospace');
		expect(cleanFontFamily('"a</style><script>", "b;c", Menlo')).toBe('Menlo, monospace');
	});
	it('cleans font stacks', () => {
		expect(cleanFontFamily(`"??", Menlo, monospace`)).toBe('Menlo, monospace');
		expect(cleanFontFamily(`'??'`)).toContain('monospace');
		expect(cleanFontFamily('Fira Code')).toBe('Fira Code, monospace');
	});
});

describe('sanitizeSettings', () => {
	it('returns defaults for garbage', () => {
		expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings({ fontSize: 'big', background: 'url(evil)', showBanner: 'yes', openLocation: 'toString' })).toEqual(DEFAULT_SETTINGS);
	});
	it('clamps the font size and keeps valid values', () => {
		expect(sanitizeSettings({ fontSize: 2 }).fontSize).toBe(FONT_SIZE_MIN);
		expect(sanitizeSettings({ fontSize: 999 }).fontSize).toBe(FONT_SIZE_MAX);
		expect(sanitizeSettings({ fontSize: Infinity }).fontSize).toBe(DEFAULT_SETTINGS.fontSize);
		expect(sanitizeSettings({ fontSize: 15.6, background: 'plum', showBanner: false, openLocation: 'window' })).toEqual({
			fontSize: 16,
			background: 'plum',
			showBanner: false,
			openLocation: 'window',
		});
	});
	it('offers only the colors of the palette', () => {
		expect(effectiveBackground(sanitizeSettings({ background: 'black' }))).toBe('#000000');
		expect(effectiveBackground(sanitizeSettings({ background: 'white' }))).toBe('#ffffff');
		expect(effectiveBackground(sanitizeSettings({ background: 'theme' }))).toBe('');
		for (const bad of ['#abcdef', 'toString', '__proto__', 'Black', null]) expect(sanitizeSettings({ background: bad }).background).toBe('theme');
		for (const { color } of Object.values(BACKGROUNDS)) expect(color === '' || isHexColor(color)).toBe(true);
	});
	it('keeps the octopus and the text readable on every color of the palette', () => {
		const body = { r: 64, g: 64, b: 64, a: 1 };
		for (const { name, color } of Object.values(BACKGROUNDS)) {
			const bg = parseColor(color);
			if (!bg) continue;
			// Dark backgrounds get light text, light ones dark text (see theme.ts).
			const text = isDark(bg) ? WHITE : BLACK;
			expect(contrast(text, bg), name).toBeGreaterThan(7);
			expect(contrast(body, bg), name).toBeGreaterThan(1.4);
		}
	});
	it('reads settings saved by earlier builds', () => {
		expect(sanitizeSettings({ blackBackground: true, background: '#1e1e2e' }).background).toBe('black');
		expect(sanitizeSettings({ blackBackground: false, background: '#1e1e2e' }).background).toBe('theme');
		expect(sanitizeSettings({ backgroundMode: 'white' }).background).toBe('white');
		expect(sanitizeSettings({ blackBackground: 'yes' }).background).toBe('theme');
	});
	it('drops unknown keys', () => {
		expect(sanitizeSettings({ shell: '/tmp/evil', __proto__: { polluted: true } })).toEqual(DEFAULT_SETTINGS);
	});
});
