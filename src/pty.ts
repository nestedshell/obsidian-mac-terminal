// Runs the shell through mt-pty (native/mt-pty.c), a small helper process that owns
// the pseudo-terminal. Nothing native is loaded into Obsidian: if anything goes
// wrong on the terminal side, only the helper dies, never the app.
import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Writable } from 'stream';

/* global MT_PTY_SHA256, MT_PTY_BASE64 -- injected by scripts/build.mjs, declared in globals.d.ts */

export const HELPER_NAME = 'mt-pty';
/** How long the helper gets to hang up the shell before it is killed. */
const HELPER_KILL_MS = 5000;
/** The helper is about 100 KB: anything much bigger is not it. */
const HELPER_MAX_BYTES = 4 * 1024 * 1024;
/** Input waiting for a program that stopped reading; beyond this it is dropped. */
const INPUT_QUEUE_MAX = 4 * 1024 * 1024;

export class PtyError extends Error {}

export interface PtyOptions {
	file: string;
	args: string[];
	cols: number;
	rows: number;
	cwd: string;
	env: Record<string, string>;
}

export interface PtyExit {
	/** Exit code when the shell exited by itself, null when a signal ended it. */
	code: number | null;
	/** Signal that ended the shell (or the helper itself), e.g. "SIGKILL". */
	signal: string | null;
	/** Diagnostics the helper printed (spawn failures and the like). */
	message: string;
}

/** Parses the helper's final "X <code> <signal>" report. */
export function parseExitReport(text: string): { code: number | null; signal: string | null } | null {
	const m = /^X (-?\d{1,3}) (\d{1,2})\n/m.exec(text);
	if (!m) return null;
	const code = Number(m[1]);
	const sig = Number(m[2]);
	return { code: code >= 0 && code <= 255 ? code : null, signal: sig > 0 ? signalName(sig) : null };
}

function signalName(n: number): string {
	const entry = Object.entries(os.constants.signals).find(([, value]) => value === n);
	return entry ? entry[0] : `signal ${n}`;
}

/**
 * Returns the path of the helper to run: the bytes built into main.js, checked
 * against their SHA-256 and written to a folder only this user can write to. The
 * copy is checked again before every use, so a changed file is replaced, never run.
 */
export function prepareHelper(encoded: string = MT_PTY_BASE64, expected: string = MT_PTY_SHA256, stageRoot: string = os.tmpdir()): string {
	const data = Buffer.from(encoded, 'base64');
	if (!/^[0-9a-f]{64}$/.test(expected) || data.length === 0 || data.length > HELPER_MAX_BYTES || sha256(data) !== expected) {
		throw new PtyError(`The terminal helper inside main.js is damaged. Reinstall the plugin.`);
	}
	try {
		return stageHelper(data, expected, stageRoot);
	} catch (error) {
		throw new PtyError(`The terminal helper can't be prepared: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Reads a file only if it is a regular file of at most `max` bytes. Symbolic links
 * are refused, and devices or pipes are never read (they could block or never end).
 */
function readRegularFile(file: string, max: number): Buffer {
	const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
		if (stat.size > max) throw new Error(`${file} is too large`);
		const data = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < data.length) {
			const n = fs.readSync(fd, data, offset, data.length - offset, offset);
			if (n === 0) break;
			offset += n;
		}
		if (offset !== data.length) throw new Error(`${file} changed while it was read`);
		return data;
	} finally {
		fs.closeSync(fd);
	}
}

function sha256(data: Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

/** Writes the checked helper to <stageRoot>/mac-terminal-<uid>/mt-pty-<hash>, or reuses an identical copy. */
function stageHelper(data: Buffer, hash: string, stageRoot: string): string {
	const uid = process.getuid?.() ?? -1;
	const dir = path.join(stageRoot, `mac-terminal-${uid}`);
	try {
		fs.mkdirSync(dir, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
	}
	// The folder must be ours and private: a shared temporary folder could hold a trap.
	const info = fs.lstatSync(dir);
	if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077) !== 0) throw new Error(`${dir} is not a private folder`);

	const target = path.join(dir, `${HELPER_NAME}-${hash.slice(0, 16)}`);
	try {
		if (sha256(readRegularFile(target, HELPER_MAX_BYTES)) === hash && (fs.statSync(target).mode & 0o777) === 0o700) return target;
	} catch {
		// Missing or different: write it again.
	}
	const temp = path.join(dir, `.${HELPER_NAME}-${process.pid}-${Date.now()}`);
	const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o700);
	try {
		fs.writeSync(fd, data, 0, data.length, 0);
		fs.fchmodSync(fd, 0o700);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temp, target);
	return target;
}

/** A shell running in a pseudo-terminal, behind the helper process. */
export class PtySession {
	readonly pid: number;
	private readonly child: ChildProcess;
	private readonly control: Writable | null;
	private exited = false;
	private stderr = '';
	private report = '';
	private dataListener: ((data: string) => void) | null = null;
	private exitListener: ((exit: PtyExit) => void) | null = null;
	private killTimer: number | null = null;

	constructor(helper: string, opts: PtyOptions) {
		const cols = clampDim(opts.cols);
		const rows = clampDim(opts.rows);
		this.child = spawn(helper, [String(cols), String(rows), opts.file, ...opts.args], {
			cwd: opts.cwd,
			env: opts.env,
			stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		if (this.child.pid === undefined) {
			// spawn reports the reason through the 'error' event; give a clear message now.
			this.child.on('error', () => undefined);
			throw new PtyError(`Could not start the terminal helper (${HELPER_NAME}).`);
		}
		this.pid = this.child.pid;
		this.control = (this.child.stdio[3] as Writable | null) ?? null;

		const ignore = () => undefined;
		this.child.stdin?.on('error', ignore);
		this.control?.on('error', ignore);
		this.control?.on('data', (chunk: Buffer | string) => {
			if (this.report.length < 256) this.report += chunk.toString();
		});
		this.child.stdout?.setEncoding('utf8'); // decodes UTF-8 split across chunks
		this.child.stdout?.on('data', (data: string) => this.dataListener?.(data));
		this.child.stderr?.setEncoding('utf8');
		this.child.stderr?.on('data', (data: string) => {
			if (this.stderr.length < 4096) this.stderr += data;
		});
		this.child.on('error', (error) => {
			if (!this.stderr) this.stderr = error.message;
		});
		this.child.on('exit', () => {
			this.exited = true;
			if (this.killTimer !== null) window.clearTimeout(this.killTimer);
		});
		// 'close' comes after the last output and the exit report have been read.
		this.child.on('close', (code, signal) => {
			this.exited = true;
			const reported = parseExitReport(this.report);
			const exit = reported ?? { code: signal ? null : code, signal: signal ?? null };
			this.exitListener?.({ ...exit, message: this.stderr.trim() });
		});
	}

	onData(listener: (data: string) => void): void {
		this.dataListener = listener;
	}

	onExit(listener: (exit: PtyExit) => void): void {
		this.exitListener = listener;
	}

	/** Returns false when the input was dropped because the program stopped reading. */
	write(data: string | Buffer): boolean {
		const stdin = this.child.stdin;
		if (this.exited || !stdin?.writable) return true;
		if (stdin.writableLength > INPUT_QUEUE_MAX) return false;
		stdin.write(data);
		return true;
	}

	/** Ignores sizes that aren't positive finite numbers (a hidden pane measures 0). */
	resize(cols: number, rows: number): void {
		if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return;
		if (!this.exited && this.control?.writable) this.control.write(`W ${clampDim(cols)} ${clampDim(rows)}\n`);
	}

	pause(): void {
		this.child.stdout?.pause();
	}

	resume(): void {
		this.child.stdout?.resume();
	}

	/** Hangs up the shell (SIGHUP to its session); kills the helper if it doesn't finish. */
	close(): void {
		this.dataListener = null;
		this.exitListener = null;
		this.resume();
		if (this.exited) return;
		this.child.kill('SIGHUP');
		this.killTimer = window.setTimeout(() => {
			if (!this.exited) this.child.kill('SIGKILL');
		}, HELPER_KILL_MS);
	}
}

function clampDim(n: number): number {
	return Number.isFinite(n) ? Math.max(1, Math.min(4096, Math.floor(n))) : 80;
}
