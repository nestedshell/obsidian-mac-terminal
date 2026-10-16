import type { ITheme } from '@xterm/xterm';
import { BLACK, WHITE, contrast, flatten, isDark, mix, parseColor, toCss, toHex, type Rgb } from './color';

/** ANSI palettes tuned for dark and light backgrounds (based on VS Code's). */
const DARK_ANSI = {
	black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
	blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
	brightBlack: '#767676', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
	brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
};
const LIGHT_ANSI = {
	black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800',
	blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
	brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00',
	brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
};

const FALLBACK_FONT = 'Menlo, Monaco, "SF Mono", monospace';

export interface Appearance {
	theme: ITheme;
	fontFamily: string;
	/** Opaque background actually used, for the area around the text grid. */
	background: string;
	/** Accent colour of the Obsidian theme, used by the startup art. */
	accent: Rgb;
	dark: boolean;
}

/**
 * Reads the Obsidian theme from CSS variables, resolved by the browser through a
 * probe element so any colour syntax a theme uses (hsl, calc, color-mix…) works.
 */
export function readAppearance(host: HTMLElement, customBackground: string): Appearance {
	const probe = host.createSpan({ cls: 'mac-terminal-probe' });
	const resolve = (cssVar: string, fallback: Rgb): Rgb => {
		probe.setCssProps({ color: `var(${cssVar}, ${toCss(fallback)})` });
		return parseColor(host.win.getComputedStyle(probe).color) ?? fallback;
	};

	try {
		const themeBg = flatten(resolve('--background-primary', WHITE), WHITE);
		const bg = parseColor(customBackground) ?? themeBg;
		const dark = isDark(bg);

		let fg = flatten(resolve('--text-normal', dark ? WHITE : BLACK), bg);
		// A custom background can clash with the theme's text colour: keep text readable.
		if (contrast(fg, bg) < 4.5) fg = dark ? mix(WHITE, bg, 0.12) : mix(BLACK, bg, 0.15);

		const accent = flatten(resolve('--interactive-accent', { r: 124, g: 92, b: 246, a: 1 }), bg);
		const cursor = contrast(accent, bg) >= 3 ? accent : fg;
		let selection = resolve('--text-selection', { ...accent, a: 0.35 });
		if (selection.a >= 1) selection = { ...selection, a: 0.4 };

		// .mac-terminal-probe sets font-family: var(--font-monospace).
		const fontFamily = cleanFontFamily(host.win.getComputedStyle(probe).fontFamily);

		return {
			fontFamily,
			background: toHex(bg),
			accent,
			dark,
			theme: {
				...(dark ? DARK_ANSI : LIGHT_ANSI),
				background: toHex(bg),
				foreground: toHex(fg),
				cursor: toHex(cursor),
				cursorAccent: toHex(bg),
				selectionBackground: toCss(selection),
				selectionInactiveBackground: toCss({ ...selection, a: selection.a * 0.6 }),
				scrollbarSliderBackground: toCss({ ...fg, a: 0.15 }),
				scrollbarSliderHoverBackground: toCss({ ...fg, a: 0.3 }),
				scrollbarSliderActiveBackground: toCss({ ...fg, a: 0.4 }),
			},
		};
	} finally {
		probe.remove();
	}
}

/** Resolves one theme colour variable (such as --color-red) to RGB. */
export function readThemeColor(host: HTMLElement, cssVar: string, fallback: Rgb): Rgb {
	const probe = host.createSpan({ cls: 'mac-terminal-probe' });
	try {
		probe.setCssProps({ color: `var(${cssVar}, ${toCss(fallback)})` });
		return parseColor(host.win.getComputedStyle(probe).color) ?? fallback;
	} finally {
		probe.remove();
	}
}

/** Drops Obsidian's "??" placeholders and makes sure a monospace fallback is last. */
export function cleanFontFamily(value: string): string {
	const parts = (value || '')
		.split(',')
		.map((p) => p.trim())
		// xterm writes the font into a stylesheet: nothing that could end the rule.
		// eslint-disable-next-line no-control-regex -- control characters are what is refused
		.filter((p) => p.length > 0 && !/^["']?\?\?["']?$/.test(p) && !/[{}<>;\\\u0000-\u001f]/.test(p));
	if (parts.length === 0) return FALLBACK_FONT;
	if (!parts.some((p) => p.toLowerCase() === 'monospace')) parts.push('monospace');
	return parts.join(', ');
}
