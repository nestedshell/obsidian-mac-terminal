// Compiles native/mt-pty.c into a universal (Apple silicon + Intel) executable.
// Needs the Xcode Command Line Tools (xcode-select --install).
//   npm run build:helper   compile it into native/mt-pty, the copy the build embeds
//   npm run check:helper   tell whether native/mt-pty matches the source on this Mac
// native/mt-pty is kept in the repository so `npm run build` needs no compiler and
// gives the same main.js on any machine.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HELPER_SOURCE = path.join(root, 'native', 'mt-pty.c');
export const HELPER_BINARY = path.join(root, 'native', 'mt-pty');

const FLAGS = [
	'-std=gnu11', '-O2',
	'-Wall', '-Wextra', '-Wpedantic', '-Wformat=2', '-Wshadow', '-Wconversion', '-Wno-sign-conversion', '-Werror',
	'-fstack-protector-strong', '-D_FORTIFY_SOURCE=2',
	'-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0',
];

export function compileHelper(outFile) {
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	try {
		execFileSync('xcrun', ['clang', ...FLAGS, '-o', outFile, HELPER_SOURCE], { stdio: 'inherit' });
	} catch (error) {
		throw new Error(`Could not compile ${path.relative(root, HELPER_SOURCE)}. Install the Xcode Command Line Tools: xcode-select --install\n${error.message}`);
	}
	// Ad-hoc signature: required to run on Apple silicon, and stable for the hash check.
	execFileSync('codesign', ['--force', '--sign', '-', outFile], { stdio: 'inherit' });
	fs.chmodSync(outFile, 0o755);
	return outFile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) {
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pty-check-'));
		try {
			const fresh = fs.readFileSync(compileHelper(path.join(temp, 'mt-pty')));
			if (fresh.equals(fs.readFileSync(HELPER_BINARY))) {
				console.log('✓ native/mt-pty matches native/mt-pty.c');
			} else {
				console.error('✗ native/mt-pty differs from a fresh build (changed source, or another Xcode version): npm run build:helper');
				process.exitCode = 1;
			}
		} finally {
			fs.rmSync(temp, { recursive: true, force: true });
		}
	} else {
		compileHelper(HELPER_BINARY);
		console.log(`✓ ${path.relative(root, HELPER_BINARY)} built from ${path.relative(root, HELPER_SOURCE)}`);
	}
}
