// Small colour toolkit: parse CSS colours, measure contrast, mix shades.

export interface Rgb {
	r: number;
	g: number;
	b: number;
	a: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` (what computed styles return). */
export function parseColor(value: string | null | undefined): Rgb | null {
	if (!value) return null;
	const v = value.trim().toLowerCase();
	let m = /^#([0-9a-f]{3})$/.exec(v);
	if (m) {
		const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
		return { r, g, b, a: 1 };
	}
	m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
	if (m) {
		const n = parseInt(m[1], 16);
		return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
	}
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
	if (m) {
		let a = 1;
		if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
		return { r: clamp255(+m[1]), g: clamp255(+m[2]), b: clamp255(+m[3]), a: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1 };
	}
	return null;
}

export function isHexColor(value: unknown): value is string {
	return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function toHex(c: Rgb): string {
	return '#' + [c.r, c.g, c.b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('');
}

export function toCss(c: Rgb): string {
	return c.a >= 1 ? toHex(c) : `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}

/** Composites a translucent colour over an opaque one. */
export function flatten(c: Rgb, over: Rgb): Rgb {
	return { r: c.r * c.a + over.r * (1 - c.a), g: c.g * c.a + over.g * (1 - c.a), b: c.b * c.a + over.b * (1 - c.a), a: 1 };
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(c: Rgb): number {
	const ch = (n: number) => {
		const s = n / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function contrast(a: Rgb, b: Rgb): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isDark(c: Rgb): boolean {
	return luminance(c) < 0.18;
}

/** Linear mix: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
	return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
}

export const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
