// Integration tests: compile the real helper and drive real shells through it.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS build script
import { compileHelper } from '../scripts/helper.mjs';
import { PtyError, PtySession, parseExitReport, prepareHelper, type PtyExit } from '../src/pty';

let dir: string;
let helper: string;
let hash: string;
let encoded: string;

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pty-test-'));
	helper = compileHelper(path.join(dir, 'mt-pty'));
	hash = createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
	encoded = fs.readFileSync(helper).toString('base64');
}, 60000);

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

const ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TERM: 'xterm-256color', LANG: 'en_US.UTF-8', PS1: '$ ' };

function start(opts: Partial<{ helper: string; cols: number; rows: number; cwd: string; file: string; args: string[] }> = {}) {
	const pty = new PtySession(opts.helper ?? helper, {
		file: opts.file ?? '/bin/sh',
		args: opts.args ?? [],
		cols: opts.cols ?? 80,
		rows: opts.rows ?? 24,
		cwd: opts.cwd ?? dir,
		env: ENV,
	});
	let out = '';
	pty.onData((d) => (out += d));
	const exited = new Promise<PtyExit>((resolve) => pty.onExit(resolve));
	const waitFor = async (text: string, ms = 5000) => {
		const t0 = Date.now();
		while (!out.includes(text)) {
			if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${JSON.stringify(text)} in ${JSON.stringify(out.slice(-300))}`);
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	return { pty, exited, waitFor, output: () => out.replace(/\r/g, '') };
}

/** True while the process exists (EPERM also means it exists). */
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};

describe('prepareHelper', () => {
	const stage = () => fs.mkdtempSync(path.join(dir, 'stage-'));
	const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

	it('writes a private copy of exactly the bytes it checked', () => {
		const root = stage();
		const staged = prepareHelper(encoded, hash, root);
		expect(path.dirname(path.dirname(staged))).toBe(root);
		expect(sha(staged)).toBe(hash);
		expect(fs.statSync(staged).mode & 0o777).toBe(0o700);
		expect(fs.statSync(path.dirname(staged)).mode & 0o777).toBe(0o700);
		const mtime = fs.statSync(staged).mtimeMs;
		expect(prepareHelper(encoded, hash, root)).toBe(staged);
		expect(fs.statSync(staged).mtimeMs).toBe(mtime);
		// A tampered copy is replaced, not run.
		fs.writeFileSync(staged, 'evil');
		expect(sha(prepareHelper(encoded, hash, root))).toBe(hash);
	});
	it('runs the copy it writes', async () => {
		const { pty, exited, waitFor } = start({ helper: prepareHelper(encoded, hash, stage()), args: ['-c', 'echo staged-ok'] });
		await waitFor('staged-ok');
		expect((await exited).code).toBe(0);
		expect(pty.pid).toBeGreaterThan(0);
	});
	it('rejects bytes that do not match the hash', () => {
		const damaged = Buffer.from(encoded, 'base64');
		damaged[damaged.length - 1] ^= 1;
		expect(() => prepareHelper(damaged.toString('base64'), hash, stage())).toThrow(/damaged/);
		expect(() => prepareHelper(encoded, '0'.repeat(64), stage())).toThrow(PtyError);
		expect(() => prepareHelper(encoded, 'not-a-hash', stage())).toThrow(PtyError);
		expect(() => prepareHelper('', hash, stage())).toThrow(/damaged/);
		expect(() => prepareHelper(Buffer.alloc(8 * 1024 * 1024).toString('base64'), hash, stage())).toThrow(/damaged/);
	});
	it('replaces a link or a pipe planted where the copy goes, without following it', () => {
		for (const make of [
			(f: string) => fs.symlinkSync('/dev/zero', f),
			(f: string) => execFileSync('/usr/bin/mkfifo', [f]),
		]) {
			const root = stage();
			const folder = path.join(root, `mac-terminal-${process.getuid?.()}`);
			fs.mkdirSync(folder, { mode: 0o700 });
			const target = path.join(folder, `mt-pty-${hash.slice(0, 16)}`);
			make(target);
			const t0 = Date.now();
			expect(prepareHelper(encoded, hash, root)).toBe(target);
			expect(Date.now() - t0).toBeLessThan(1000);
			expect(fs.lstatSync(target).isFile()).toBe(true);
			expect(sha(target)).toBe(hash);
		}
	});
	it('refuses a staging folder that others can write to', () => {
		const root = stage();
		const shared = path.join(root, `mac-terminal-${process.getuid?.()}`);
		fs.mkdirSync(shared);
		fs.chmodSync(shared, 0o777);
		expect(() => prepareHelper(encoded, hash, root)).toThrow(/private/);
	});
});

describe('parseExitReport', () => {
	it('reads code and signal', () => {
		expect(parseExitReport('X 3 0\n')).toEqual({ code: 3, signal: null });
		expect(parseExitReport('X -1 9\n')).toEqual({ code: null, signal: 'SIGKILL' });
		expect(parseExitReport('X -1 1\n')).toEqual({ code: null, signal: 'SIGHUP' });
	});
	it('ignores anything malformed', () => {
		expect(parseExitReport('')).toBeNull();
		expect(parseExitReport('X 3')).toBeNull();
		expect(parseExitReport('X 99999 0\n')).toBeNull();
		expect(parseExitReport('X 300 0\n')).toEqual({ code: null, signal: null });
	});
});

describe('PtySession', () => {
	it('tells a shell killed by a signal from one that exited', async () => {
		const s = start();
		s.pty.write('kill -9 $$\n');
		expect(await s.exited).toMatchObject({ code: null, signal: 'SIGKILL' });
		const t = start();
		t.pty.write('exit 137\n');
		expect(await t.exited).toMatchObject({ code: 137, signal: null });
	});

	it('uses the Terminal.app control characters (NUL is not a control key)', async () => {
		const s = start({ file: '/bin/bash', args: ['--norc', '--noprofile'] });
		s.pty.write('stty -a; exit\n');
		await s.exited;
		const out = s.output();
		expect(out).toMatch(/dsusp = \^Y/);
		expect(out).toMatch(/status = \^T/);
		expect(out).not.toMatch(/= \^@/);
	});

	it('runs the shell in the folder with the given size and environment', async () => {
		const s = start({ cols: 100, rows: 30 });
		s.pty.write('stty size; pwd; echo "T=$TERM"; tty; exit 5\n');
		const exit = await s.exited;
		expect(exit).toMatchObject({ code: 5, signal: null });
		expect(s.output()).toContain('30 100');
		expect(s.output()).toContain(fs.realpathSync(dir));
		expect(s.output()).toContain('T=xterm-256color');
		expect(s.output()).toMatch(/\/dev\/ttys\d+/);
	});

	it('resizes the terminal and ignores malformed sizes', async () => {
		const s = start();
		s.pty.resize(132, 50);
		s.pty.resize(Number.NaN, 0);
		await new Promise((r) => setTimeout(r, 100));
		s.pty.write('stty size; exit\n');
		await s.exited;
		expect(s.output()).toContain('50 132');
	});

	it('keeps UTF-8 intact across chunk boundaries', async () => {
		const s = start();
		s.pty.write(`i=0; while [ $i -lt 2000 ]; do printf 'àèìòù你好🎉'; i=$((i+1)); done; echo; echo END; exit\n`);
		await s.exited;
		const text = s.output();
		expect(text).not.toContain('�');
		expect(text.split('àèìòù你好🎉').length - 1).toBeGreaterThanOrEqual(2000);
	});

	it('delivers Ctrl+C to the foreground job', async () => {
		const s = start();
		s.pty.write('sleep 30; echo AFTER-$?\n');
		await new Promise((r) => setTimeout(r, 300));
		s.pty.write('\u0003');
		await s.waitFor('AFTER-130');
		s.pty.write('exit\n');
		await s.exited;
	});

	it('close() hangs up the shell and its jobs', async () => {
		const s = start();
		s.pty.write('set +H\n'); // interactive bash would expand "!:" from history
		s.pty.write('sleep 300 & echo "BG=$!:$((1+1))"\n');
		await s.waitFor(':2');
		const bg = Number(/BG=(\d+):2/.exec(s.output())?.[1]);
		expect(alive(bg)).toBe(true);
		// Close from the prompt, as a user does: right after a command bash briefly
		// leaves SIGHUP at its default and can die without passing it on to its jobs.
		while (!/BG=\d+:2[\s\S]*\$ $/.test(s.output())) await new Promise((r) => setTimeout(r, 10));
		await new Promise((r) => setTimeout(r, 100));
		s.pty.close();
		// The shell passes the hangup on to its jobs; give it time on a busy machine.
		for (let waited = 0; waited < 3000 && (alive(bg) || alive(s.pty.pid)); waited += 50) {
			await new Promise((r) => setTimeout(r, 50));
		}
		expect(alive(bg)).toBe(false);
		expect(alive(s.pty.pid)).toBe(false);
	});

	it('kills a shell that ignores SIGHUP', async () => {
		const s = start({ file: '/bin/bash', args: ['--norc', '--noprofile'] });
		s.pty.write("trap '' HUP TERM; echo TRAPPED-$((1+1))\n");
		await s.waitFor('TRAPPED-2');
		const t0 = Date.now();
		s.pty.close();
		while (alive(s.pty.pid) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
		expect(alive(s.pty.pid)).toBe(false);
	}, 10000);

	it('kills a program that ignores the hangup', async () => {
		const s = start({ file: '/bin/sh', args: ['-c', "trap '' HUP TERM; echo PID=$$:$((1+1)); while :; do sleep 1; done"] });
		await s.waitFor(':2');
		const program = Number(/PID=(\d+):2/.exec(s.output())?.[1]);
		expect(alive(program)).toBe(true);
		s.pty.close();
		const t0 = Date.now();
		while ((alive(program) || alive(s.pty.pid)) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
		expect(alive(program)).toBe(false);
		expect(alive(s.pty.pid)).toBe(false);
	}, 10000);

	it('wakes a stopped shell so it can handle the hangup', async () => {
		const mark = path.join(dir, `hup-${Date.now()}`);
		const s = start({ file: '/bin/bash', args: ['--norc', '--noprofile'] });
		s.pty.write(`trap 'echo got > "${mark}"; exit 0' HUP; echo READY-$((1+1)); kill -STOP $$\n`);
		await s.waitFor('READY-2');
		await new Promise((r) => setTimeout(r, 200));
		const t0 = Date.now();
		s.pty.close();
		while (alive(s.pty.pid) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
		expect(Date.now() - t0).toBeLessThan(1500);
		expect(fs.existsSync(mark)).toBe(true);
	});

	it('hangs up when the plugin goes away, even with unread input', async () => {
		const child = spawn(helper, ['80', '24', '/bin/sh', '-c', 'echo PID=$$:$((1+1)); exec sleep 30'], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stdin.on('error', () => undefined);
		while (!/PID=\d+:2/.test(out)) await new Promise((r) => setTimeout(r, 20));
		const program = Number(/PID=(\d+):2/.exec(out)?.[1]);
		child.stdin.write(Buffer.alloc(200_000, 0x61)); // more than the helper buffers
		await new Promise((r) => setTimeout(r, 200));
		(child.stdio[3] as NodeJS.WritableStream & { destroy(): void }).destroy(); // what a crashed renderer leaves behind
		const t0 = Date.now();
		while ((alive(program) || alive(child.pid!)) && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
		expect(alive(program)).toBe(false);
		expect(alive(child.pid!)).toBe(false);
		child.stdin.destroy();
	});

	it('stops queueing input for a program that stopped reading', async () => {
		const s = start({ file: '/bin/sh', args: ['-c', 'stty raw -echo; echo READY-$((1+1)); sleep 30'] });
		await s.waitFor('READY-2');
		const chunk = Buffer.alloc(1024 * 1024, 0x61);
		let accepted = 0;
		while (accepted < 50 && s.pty.write(chunk)) accepted++;
		expect(accepted).toBeLessThan(10);
		s.pty.close();
	});

	it('reports a shell that cannot start', async () => {
		const s = start({ file: '/nonexistent/shell' });
		const exit = await s.exited;
		expect(exit).toMatchObject({ code: 127, signal: null });
		expect(s.output()).toContain('cannot run /nonexistent/shell');
	});

	it('gives the shell no descriptor but the terminal', async () => {
		const s = start({ file: '/bin/bash', args: ['--norc', '--noprofile'] });
		s.pty.write('for f in /dev/fd/*; do [ -e "$f" ] && echo "FD:${f##*/}"; done; exit\n');
		await s.exited;
		const fds = [...s.output().matchAll(/FD:(\d+)/g)].map((m) => Number(m[1]));
		// 0-2 are the terminal; bash keeps one more for itself (255).
		expect(fds.filter((fd) => fd > 2).length).toBeLessThanOrEqual(1);
	});

	it('keeps up with a large burst and applies backpressure while paused', async () => {
		const s = start();
		s.pty.pause();
		// The marker is computed by the shell so the echoed command line can't match it.
		s.pty.write('head -c 3000000 /dev/zero | tr "\\000" x; echo; echo BURST-$((40+2))\n');
		await new Promise((r) => setTimeout(r, 300));
		const whilePaused = s.output().length;
		expect(whilePaused).toBeLessThan(1_000_000);
		s.pty.resume();
		await s.waitFor('BURST-42', 20000);
		expect(s.output().split('x').length - 1).toBeGreaterThanOrEqual(3_000_000);
		s.pty.write('exit\n');
		await s.exited;
	}, 30000);
});
