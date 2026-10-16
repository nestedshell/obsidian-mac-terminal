import { describe, expect, it } from 'vitest';
import { TAG_COLORS, TAG_NAME_MAX, isTagColor, sanitizeTag, sanitizeTagName, tagColorVar } from '../src/tag';

describe('sanitizeTagName', () => {
	it('keeps a normal name, accents and emoji', () => {
		expect(sanitizeTagName('  App iOS – àèì 🚀 ')).toBe('App iOS – àèì 🚀');
	});
	it('makes one line without control or bidi characters', () => {
		expect(sanitizeTagName('a\r\nb\tc')).toBe('a b c');
		expect(sanitizeTagName('x\u001b]0;evil\u0007y')).toBe('x]0;evily');
		expect(sanitizeTagName('abc‮dcba')).toBe('abcdcba');
		expect(sanitizeTagName('a\u0000b\u009bc')).toBe('abc');
	});
	it('limits the length without splitting a character', () => {
		expect(Array.from(sanitizeTagName('x'.repeat(500)))).toHaveLength(TAG_NAME_MAX);
		const family = '👨‍👩‍👧';
		const name = sanitizeTagName('a'.repeat(TAG_NAME_MAX - 1) + family + 'zzz');
		expect(name.endsWith(family)).toBe(true);
	});
	it('stays small whatever the saved name is made of', () => {
		for (const evil of ['a' + '\u0301'.repeat(1_000_000), '👨' + '\u200d👩'.repeat(150_000), 'x' + '\u{e0061}'.repeat(200_000)]) {
			const name = sanitizeTagName(evil);
			expect(name.length).toBeLessThanOrEqual(240);
		}
		expect(sanitizeTagName('e' + '\u0301'.repeat(50))).toBe('e' + '\u0301'.repeat(4));
	});
	it('refuses names that would look blank', () => {
		for (const blank of ['\u3164', '\u115f\u200b\u2060', '\u00ad\u00ad', '\u200d\ufe0f', '\u0301\u0301']) {
			expect(sanitizeTagName(blank)).toBe('');
		}
		expect(sanitizeTagName('A\u200bpp')).toBe('App');
		expect(sanitizeTagName('👩‍💻 Code')).toBe('👩‍💻 Code');
	});
	it('ignores anything that is not a string', () => {
		expect(sanitizeTagName(undefined)).toBe('');
		expect(sanitizeTagName({ toString: () => 'evil' })).toBe('');
		expect(sanitizeTagName(42)).toBe('');
	});
});

describe('sanitizeTag', () => {
	it('accepts only the theme colours', () => {
		expect(sanitizeTag({ name: 'App', color: 'red' })).toEqual({ name: 'App', color: 'red' });
		for (const bad of ['toString', '__proto__', 'red; background: url(x)', '#ff0000', 'RED', null]) {
			expect(sanitizeTag({ color: bad }).color).toBe('');
		}
	});
	it('maps colours to Obsidian variables', () => {
		for (const color of Object.keys(TAG_COLORS)) {
			expect(isTagColor(color)).toBe(true);
			expect(tagColorVar(color as keyof typeof TAG_COLORS)).toMatch(/^--color-[a-z]+$/);
		}
	});
});
