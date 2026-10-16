// Name and colour dot of a terminal tab (no Obsidian imports, so it can be unit tested).
import type { Rgb } from './color';
import { capCombiningMarks, sanitizeForDisplay } from './text';

/** Obsidian's theme colours: each theme can tune them, the fallbacks are the defaults. */
export const TAG_COLORS = {
	red: { label: 'Red', fallback: { r: 233, g: 49, b: 71, a: 1 } },
	orange: { label: 'Orange', fallback: { r: 236, g: 117, b: 0, a: 1 } },
	yellow: { label: 'Yellow', fallback: { r: 224, g: 172, b: 0, a: 1 } },
	green: { label: 'Green', fallback: { r: 8, g: 185, b: 78, a: 1 } },
	cyan: { label: 'Cyan', fallback: { r: 0, g: 191, b: 188, a: 1 } },
	blue: { label: 'Blue', fallback: { r: 8, g: 109, b: 221, a: 1 } },
	purple: { label: 'Purple', fallback: { r: 120, g: 82, b: 238, a: 1 } },
	pink: { label: 'Pink', fallback: { r: 213, g: 57, b: 132, a: 1 } },
} satisfies Record<string, { label: string; fallback: Rgb }>;

export type TagColor = keyof typeof TAG_COLORS;

export const TAG_NAME_MAX = 60;
/** Upper bound in UTF-16 units, whatever the characters are made of. */
const TAG_NAME_MAX_UNITS = 240;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
/** Invisible characters that emoji need: the joiner and the presentation selectors. */
const EMOJI_JOINERS = new Set(['\u200d', '\ufe0e', '\ufe0f']);
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

export interface Tag {
	/** What the tab shows instead of the folder name; "" for none. */
	name: string;
	/** Colour of the dot; "" for none. */
	color: TagColor | '';
}

export function isTagColor(value: unknown): value is TagColor {
	return typeof value === 'string' && Object.hasOwn(TAG_COLORS, value);
}

export function tagColorVar(color: TagColor): string {
	return `--color-${color}`;
}

/**
 * One line of visible text: no control, bidi or invisible characters, single
 * spaces, at most 60 characters. A name can come from a saved workspace.
 */
export function sanitizeTagName(value: unknown): string {
	if (typeof value !== 'string') return '';
	// Bound the work first: a saved workspace can hold a name of any size.
	const head = value.slice(0, TAG_NAME_MAX_UNITS * 4).replace(/[\ud800-\udbff]$/, '');
	const visible = Array.from(sanitizeForDisplay(head.replace(/\s+/g, ' ')))
		.filter((ch) => EMOJI_JOINERS.has(ch) || !INVISIBLE.test(ch))
		.join('');
	const clean = capCombiningMarks(visible, 0, 4).text.replace(/ {2,}/g, ' ').trim();
	// Cut between whole characters, so an emoji is never split in half.
	let name = '';
	let count = 0;
	for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(clean)) {
		if (count === TAG_NAME_MAX || name.length + segment.length > TAG_NAME_MAX_UNITS) break;
		name += segment;
		count++;
	}
	name = name.trim();
	return VISIBLE.test(name) ? name : '';
}

/** Accepts whatever is in the saved workspace and returns a valid tag. */
export function sanitizeTag(raw: { name?: unknown; color?: unknown }): Tag {
	return { name: sanitizeTagName(raw.name), color: isTagColor(raw.color) ? raw.color : '' };
}
