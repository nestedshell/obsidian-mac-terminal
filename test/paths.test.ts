import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside, normalizeFolderPath, realPathOutside, resolveVaultFolder, vaultFileFromObsidianUrl } from '../src/paths';

const vault = '/Users/me/Vault';

describe('resolveVaultFolder', () => {
	it('resolves folders inside the vault', () => {
		expect(resolveVaultFolder(vault, 'Progetti/Idee nuove')).toBe('/Users/me/Vault/Progetti/Idee nuove');
		expect(resolveVaultFolder(vault, '')).toBe(vault);
		expect(resolveVaultFolder(vault, '/')).toBe(vault);
	});
	it('never leaves the vault', () => {
		expect(resolveVaultFolder(vault, '../..')).toBe(vault);
		expect(resolveVaultFolder(vault, 'a/../../etc')).toBe(vault);
		expect(resolveVaultFolder(vault, '/etc')).toBe(vault);
		expect(resolveVaultFolder(vault, '../Vault2')).toBe(vault);
		expect(resolveVaultFolder(vault, 'a\0b')).toBe(vault);
	});
	it('keeps names exactly as they are', () => {
		expect(resolveVaultFolder(vault, 'Notes ')).toBe('/Users/me/Vault/Notes ');
		expect(resolveVaultFolder(vault, ' Notes')).toBe('/Users/me/Vault/ Notes');
		expect(resolveVaultFolder(vault, 'a\\b')).toBe('/Users/me/Vault/a\\b');
	});
	it('ignores non-string state', () => {
		expect(resolveVaultFolder(vault, 42)).toBe(vault);
		expect(resolveVaultFolder(vault, { folder: 'x' })).toBe(vault);
		expect(resolveVaultFolder(vault, null)).toBe(vault);
	});
});

describe('isInside', () => {
	it('is lexical and prefix-safe', () => {
		expect(isInside(vault, vault)).toBe(true);
		expect(isInside(vault, `${vault}/a`)).toBe(true);
		expect(isInside(vault, `${vault}2`)).toBe(false);
		expect(isInside(vault, '/Users/me')).toBe(false);
		expect(isInside(vault, `${vault}/..dots`)).toBe(true);
	});
});

describe('normalizeFolderPath', () => {
	it('cleans slashes and rejects traversal', () => {
		expect(normalizeFolderPath('/a//b/')).toBe('a/b');
		expect(normalizeFolderPath('a/../b')).toBe('');
		expect(normalizeFolderPath('./a')).toBe('');
		expect(normalizeFolderPath(undefined)).toBe('');
		expect(normalizeFolderPath('..dots/x')).toBe('..dots/x');
		expect(normalizeFolderPath('Notes ')).toBe('Notes ');
		expect(normalizeFolderPath('a\\b')).toBe('a\\b');
	});
});

describe('vaultFileFromObsidianUrl', () => {
	it('reads the file of a link to this vault', () => {
		expect(vaultFileFromObsidianUrl('obsidian://open?vault=My%20Vault&file=Progetti%2FPiano', 'My Vault')).toBe('Progetti/Piano');
	});
	it('rejects other vaults, other schemes and traversal', () => {
		expect(vaultFileFromObsidianUrl('obsidian://open?vault=Other&file=x', 'My Vault')).toBeNull();
		expect(vaultFileFromObsidianUrl('https://open?vault=My%20Vault&file=x', 'My Vault')).toBeNull();
		expect(vaultFileFromObsidianUrl('obsidian://open?vault=My%20Vault&file=..%2F..%2Fetc', 'My Vault')).toBeNull();
		expect(vaultFileFromObsidianUrl('not a url', 'My Vault')).toBeNull();
	});
});

describe('realPathOutside', () => {
	it('names the real place of a folder that links out of the vault', () => {
		const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-paths-')));
		try {
			const v = path.join(tmp, 'Vault');
			fs.mkdirSync(path.join(v, 'Notes', 'Real'), { recursive: true });
			fs.mkdirSync(path.join(tmp, 'Elsewhere'));
			fs.symlinkSync(path.join(tmp, 'Elsewhere'), path.join(v, 'Notes', 'Linked'));
			fs.symlinkSync(path.join(v, 'Notes', 'Real'), path.join(v, 'Inside link'));
			expect(realPathOutside(v, resolveVaultFolder(v, 'Notes/Linked'))).toBe(path.join(tmp, 'Elsewhere'));
			expect(realPathOutside(v, resolveVaultFolder(v, 'Notes/Real'))).toBeNull();
			expect(realPathOutside(v, resolveVaultFolder(v, 'Inside link'))).toBeNull();
			expect(realPathOutside(v, resolveVaultFolder(v, 'Missing'))).toBeNull();
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
