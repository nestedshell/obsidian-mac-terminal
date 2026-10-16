// Settings model and validation (no Obsidian imports, so it can be unit tested).
import { isHexColor } from './color';

export type OpenLocation = 'tab' | 'right' | 'below' | 'window';

export interface MacTerminalSettings {
	/** Font size in pixels. */
	fontSize: number;
	/** Background colour as #rrggbb, or "" to follow the Obsidian theme. */
	background: string;
	/** Black background, whatever `background` says (switching it off restores that). */
	blackBackground: boolean;
	/** Show the startup art when a terminal opens. */
	showBanner: boolean;
	/** Where new terminals open. */
	openLocation: OpenLocation;
}

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

export const DEFAULT_SETTINGS: MacTerminalSettings = {
	fontSize: 13,
	background: '',
	blackBackground: false,
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
		background: isHexColor(data.background) ? data.background.toLowerCase() : '',
		blackBackground: typeof data.blackBackground === 'boolean' ? data.blackBackground : DEFAULT_SETTINGS.blackBackground,
		showBanner: typeof data.showBanner === 'boolean' ? data.showBanner : DEFAULT_SETTINGS.showBanner,
		openLocation: typeof data.openLocation === 'string' && Object.hasOwn(LOCATIONS, data.openLocation) ? (data.openLocation as OpenLocation) : DEFAULT_SETTINGS.openLocation,
	};
}

/** The background the terminal uses: black, a custom colour, or "" for the theme's. */
export function effectiveBackground(settings: MacTerminalSettings): string {
	return settings.blackBackground ? '#000000' : settings.background;
}
