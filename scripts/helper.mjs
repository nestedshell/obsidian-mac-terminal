// Compiles native/mt-pty.c into a universal (Apple silicon + Intel) executable.
// Needs the Xcode Command Line Tools (xcode-select --install).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HELPER_SOURCE = path.join(root, 'native', 'mt-pty.c');

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
