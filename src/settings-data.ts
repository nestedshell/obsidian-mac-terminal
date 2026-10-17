// Settings model and validation (no Obsidian imports, so it can be unit tested).
export type OpenLocation = 'tab' | 'right' | 'below' | 'window';

/**
 * The backgrounds to pick from: the theme's, and a few colours that suit a
 * terminal (and the octopus). "" means the Obsidian theme's own background.
 */
export const BACKGROUNDS = {
	theme: { name: 'Obsidian theme', color: '' },
	black: { name: 'Black', color: '#000000' },
	graphite: { name: 'Graphite', color: '#262626' },
	midnight: { name: 'Midnight blue', color: '#151b2e' },
	teal: { name: 'Deep teal', color: '#002b36' },
	plum: { name: 'Plum', color: '#2a1e33' },
	paper: { name: 'Paper', color: '#fdf6e3' },
	white: { name: 'White', color: '#ffffff' },
} as const satisfies Record<string, { name: string; color: string }>;
export type Background = keyof typeof BACKGROUNDS;

export interface MacTerminalSettings {
	/** Font size in pixels. */
	fontSize: number;
	/** The terminal background, from BACKGROUNDS. */
	background: Background;
	/** Show the startup art when a terminal opens. */
	showBanner: boolean;
	/** Where new terminals open. */
	openLocation: OpenLocation;
}

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

export const DEFAULT_SETTINGS: MacTerminalSettings = {
	fontSize: 13,
	background: 'theme',
	showBanner: true,
	openLocation: 'right',
};

/** In the order the settings list them: splits first, as they keep the note in view. */
export const LOCATIONS: Record<OpenLocation, string> = {
	right: 'Split to the right (side by side)',
	below: 'Split below (stacked)',
	tab: 'New tab',
	window: 'New window',
};

/** Accepts whatever is in data.json and returns valid settings (unknown keys dropped). */
export function sanitizeSettings(raw: unknown): MacTerminalSettings {
	const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const size = typeof data.fontSize === 'number' && Number.isFinite(data.fontSize) ? Math.round(data.fontSize) : DEFAULT_SETTINGS.fontSize;
	return {
		fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size)),
		background: backgroundOf(data),
		showBanner: typeof data.showBanner === 'boolean' ? data.showBanner : DEFAULT_SETTINGS.showBanner,
		openLocation: typeof data.openLocation === 'string' && Object.hasOwn(LOCATIONS, data.openLocation) ? (data.openLocation as OpenLocation) : DEFAULT_SETTINGS.openLocation,
	};
}

/** A background from the list; settings from early builds had a black switch instead. */
function backgroundOf(data: Record<string, unknown>): Background {
	for (const value of [data.background, data.backgroundMode]) {
		if (typeof value === 'string' && Object.hasOwn(BACKGROUNDS, value)) return value as Background;
	}
	return data.blackBackground === true ? 'black' : DEFAULT_SETTINGS.background;
}

/** The background the terminal uses as #rrggbb, or "" for the theme's. */
export function effectiveBackground(settings: MacTerminalSettings): string {
	return BACKGROUNDS[settings.background].color;
}
