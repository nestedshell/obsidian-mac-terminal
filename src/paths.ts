import * as fs from 'fs';
import * as path from 'path';

/**
 * Turns an Obsidian folder path ("Projects/Ideas", "" or "/" for the root) into
 * an absolute path inside the vault. Anything that would leave the vault, such as
 * "../.." or an absolute path, resolves to the vault root instead. The folder path
 * can come from a saved workspace, so it is treated as untrusted input.
 */
export function resolveVaultFolder(vaultRoot: string, folder: unknown): string {
	const root = path.resolve(vaultRoot);
	// No trimming or rewriting: "Notes " (trailing space) is a valid folder name.
	if (typeof folder !== 'string') return root;
	if (folder === '' || folder === '/' || folder.includes('\0') || path.isAbsolute(folder)) return root;
	const resolved = path.resolve(root, folder);
	return isInside(root, resolved) ? resolved : root;
}

/**
 * The real location of `dir` when a symbolic link inside the vault leads outside
 * it, or null. Such folders still open (linking a project into the vault is
 * common), but the terminal says where it really is before the shell starts.
 */
export function realPathOutside(vaultRoot: string, dir: string): string | null {
	try {
		const real = fs.realpathSync.native(dir);
		return isInside(fs.realpathSync.native(vaultRoot), real) ? null : real;
	} catch {
		return null;
	}
}

/** True when `child` is `parent` itself or lies below it (lexically). */
export function isInside(parent: string, child: string): boolean {
	const rel = path.relative(path.resolve(parent), path.resolve(child));
	// "..notes" is a legitimate folder name; only ".." itself or "../…" leave the parent.
	return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/** Normalises a folder path for storing in the view state ("" means vault root). */
export function normalizeFolderPath(folder: unknown): string {
	if (typeof folder !== 'string') return '';
	// Obsidian paths use "/" and never start or end with it; nothing else is rewritten.
	const clean = folder.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
	if (clean.includes('\0')) return '';
	if (clean.split('/').some((part) => part === '..' || part === '.')) return '';
	return clean;
}

/**
 * Reads the vault-relative file path out of an `obsidian://open?vault=…&file=…`
 * link (what Obsidian puts on the clipboard when a note is dragged).
 * Returns null when the link is not for this vault.
 */
export function vaultFileFromObsidianUrl(url: string, vaultName: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		return null;
	}
	if (parsed.protocol !== 'obsidian:' || parsed.hostname !== 'open') return null;
	if (parsed.searchParams.get('vault') !== vaultName) return null;
	const file = parsed.searchParams.get('file');
	if (!file) return null;
	return normalizeFolderPath(file) === '' ? null : normalizeFolderPath(file);
}
