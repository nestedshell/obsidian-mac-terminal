// The install script must never delete anything outside the plugin's own files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'install.mjs');
const dist = path.join(root, 'dist', 'mac-terminal');
let tmp: string;

const run = (...args: string[]) => {
	try {
		return { ok: true, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
	} catch (error) {
		const e = error as { stderr?: string };
		return { ok: false, out: e.stderr ?? '' };
	}
};

const vault = () => {
	const v = path.join(tmp, 'Vault');
	fs.mkdirSync(path.join(v, '.obsidian', 'plugins'), { recursive: true });
	return v;
};

beforeAll(() => {
	if (!fs.existsSync(path.join(dist, 'mt-pty'))) execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'ignore' });
}, 120000);

afterEach(() => {
	if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('install-plugin', () => {
	it('installs, keeps settings and unknown files, enables on request', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const v = vault();
		const dest = path.join(v, '.obsidian', 'plugins', 'mac-terminal');
		fs.mkdirSync(dest);
		fs.writeFileSync(path.join(dest, 'data.json'), '{"fontSize":20}');
		fs.writeFileSync(path.join(dest, 'notes.txt'), 'mine');
		fs.mkdirSync(path.join(dest, 'node-pty'));
		const r = run(v, '--enable');
		expect(r.ok).toBe(true);
		for (const f of ['main.js', 'manifest.json', 'styles.css', 'mt-pty']) expect(fs.existsSync(path.join(dest, f))).toBe(true);
		expect(fs.readFileSync(path.join(dest, 'data.json'), 'utf8')).toBe('{"fontSize":20}');
		expect(fs.readFileSync(path.join(dest, 'notes.txt'), 'utf8')).toBe('mine');
		expect(fs.existsSync(path.join(dest, 'node-pty'))).toBe(false);
		expect(fs.statSync(path.join(dest, 'mt-pty')).mode & 0o777).toBe(0o755);
		expect(JSON.parse(fs.readFileSync(path.join(v, '.obsidian', 'community-plugins.json'), 'utf8'))).toContain('mac-terminal');
	});

	it('keeps the other enabled plugins and adds itself once', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const v = vault();
		const list = path.join(v, '.obsidian', 'community-plugins.json');
		fs.writeFileSync(list, JSON.stringify(['dataview', 'calendar']));
		expect(run(v, '--enable').ok).toBe(true);
		expect(run(v, '--enable').ok).toBe(true);
		expect(JSON.parse(fs.readFileSync(list, 'utf8'))).toEqual(['dataview', 'calendar', 'mac-terminal']);
		expect(fs.readdirSync(path.join(v, '.obsidian')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('leaves an unreadable plugin list alone instead of disabling every plugin', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const v = vault();
		const list = path.join(v, '.obsidian', 'community-plugins.json');
		for (const content of ['["dataview", "calendar"', '{"dataview": true}', '["dataview", 3]']) {
			fs.writeFileSync(list, content);
			const r = run(v, '--enable');
			expect(r.ok).toBe(false);
			expect(r.out).toMatch(/Nothing was changed/);
			expect(fs.readFileSync(list, 'utf8')).toBe(content);
			expect(fs.existsSync(path.join(v, '.obsidian', 'plugins', 'mac-terminal'))).toBe(false);
		}
	});

	it('never deletes a folder that has the name of a plugin file', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const v = vault();
		const dest = path.join(v, '.obsidian', 'plugins', 'mac-terminal');
		fs.mkdirSync(path.join(dest, 'styles.css'), { recursive: true });
		fs.writeFileSync(path.join(dest, 'styles.css', 'mine.txt'), 'keep');
		const r = run(v);
		expect(r.ok).toBe(false);
		expect(r.out).toMatch(/is a folder/);
		expect(fs.readFileSync(path.join(dest, 'styles.css', 'mine.txt'), 'utf8')).toBe('keep');
	});

	it('leaves a linked plugin list alone and keeps the permissions of a real one', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const v = vault();
		const list = path.join(v, '.obsidian', 'community-plugins.json');
		const outside = path.join(tmp, 'list.json');
		fs.writeFileSync(outside, '["x"]');
		fs.symlinkSync(outside, list);
		const r = run(v, '--enable');
		expect(r.ok).toBe(false);
		expect(r.out).toMatch(/symbolic link/);
		expect(fs.readFileSync(outside, 'utf8')).toBe('["x"]');
		expect(fs.lstatSync(list).isSymbolicLink()).toBe(true);

		fs.rmSync(list);
		fs.writeFileSync(list, '["x"]', { mode: 0o600 });
		fs.chmodSync(list, 0o600);
		expect(run(v, '--enable').ok).toBe(true);
		expect(fs.statSync(list).mode & 0o777).toBe(0o600);
		expect(JSON.parse(fs.readFileSync(list, 'utf8'))).toEqual(['x', 'mac-terminal']);
	});

	it('refuses a symlinked plugin folder and deletes nothing', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const v = vault();
		const precious = path.join(tmp, 'project');
		fs.mkdirSync(precious);
		fs.writeFileSync(path.join(precious, 'main.js'), 'my code');
		fs.writeFileSync(path.join(precious, 'keep.txt'), 'keep');
		fs.symlinkSync(precious, path.join(v, '.obsidian', 'plugins', 'mac-terminal'));
		const r = run(v);
		expect(r.ok).toBe(false);
		expect(r.out).toMatch(/symbolic link/);
		expect(fs.readFileSync(path.join(precious, 'main.js'), 'utf8')).toBe('my code');
		expect(fs.readFileSync(path.join(precious, 'keep.txt'), 'utf8')).toBe('keep');
	});

	it('refuses a folder that is not a vault', () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-install-'));
		const r = run(tmp);
		expect(r.ok).toBe(false);
		expect(r.out).toMatch(/not an Obsidian vault/);
	});
});
