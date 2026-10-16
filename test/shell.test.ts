import { describe, expect, it } from 'vitest';
import { buildShellEnv, resolveShell, utf8Locale } from '../src/shell';

describe('resolveShell', () => {
	it('uses the first executable candidate and adds -l for known shells', () => {
		const ok = new Set(['/opt/homebrew/bin/fish', '/bin/zsh']);
		expect(resolveShell(['/missing/zsh', '/opt/homebrew/bin/fish'], (f) => ok.has(f))).toEqual({
			file: '/opt/homebrew/bin/fish',
			name: 'fish',
			args: ['-l'],
		});
	});
	it('falls back to /bin/zsh', () => {
		expect(resolveShell([undefined, ''], (f) => f === '/bin/zsh').file).toBe('/bin/zsh');
	});
	it('does not pass -l to unknown shells', () => {
		expect(resolveShell(['/usr/local/bin/xonsh'], () => true).args).toEqual([]);
	});
});

describe('buildShellEnv', () => {
	const opts = { shell: '/bin/zsh', home: '/Users/me', locale: 'it-IT', version: '1.0.0', localeExists: () => true };

	it('sets the terminal identity', () => {
		const env = buildShellEnv({ PATH: '/usr/bin:/bin', HOME: '/Users/me' }, opts);
		expect(env.TERM).toBe('xterm-256color');
		expect(env.COLORTERM).toBe('truecolor');
		expect(env.TERM_PROGRAM).toBe('mac-terminal');
		expect(env.TERM_PROGRAM_VERSION).toBe('1.0.0');
		expect(env.SHELL).toBe('/bin/zsh');
	});
	it('drops variables of other terminals and of Electron', () => {
		const env = buildShellEnv(
			{
				PATH: '/bin', ITERM_SESSION_ID: 'x', TERM_SESSION_ID: 'y', TMUX: 'z', ELECTRON_RUN_AS_NODE: '1', COLUMNS: '80',
				TERM_PROGRAM: 'iTerm.app', COLORFGBG: '15;0', VSCODE_PID: '1', MallocNanoZone: '0', OSLogRateLimit: '64',
				__CFBundleIdentifier: 'md.obsidian', XPC_SERVICE_NAME: 'application.md.obsidian.1', ORIGINAL_XDG_CURRENT_DESKTOP: 'undefined',
			},
			opts,
		);
		for (const key of [
			'ITERM_SESSION_ID', 'TERM_SESSION_ID', 'TMUX', 'ELECTRON_RUN_AS_NODE', 'COLUMNS', 'COLORFGBG', 'VSCODE_PID',
			'MallocNanoZone', 'OSLogRateLimit', '__CFBundleIdentifier', 'XPC_SERVICE_NAME', 'ORIGINAL_XDG_CURRENT_DESKTOP',
		]) {
			expect(env).not.toHaveProperty(key);
		}
		expect(env.TERM_PROGRAM).toBe('mac-terminal');
	});
	it('drops malformed entries', () => {
		const env = buildShellEnv({ 'A=B': 'x', NUL: 'a\0b', UNDEF: undefined, OK: 'yes' }, opts);
		expect(env).not.toHaveProperty('A=B');
		expect(env).not.toHaveProperty('NUL');
		expect(env).not.toHaveProperty('UNDEF');
		expect(env.OK).toBe('yes');
	});
	it('adds a UTF-8 locale only when none is set', () => {
		expect(buildShellEnv({}, opts).LANG).toBe('it_IT.UTF-8');
		expect(buildShellEnv({ LANG: 'en_GB.UTF-8' }, opts).LANG).toBe('en_GB.UTF-8');
		expect(buildShellEnv({ LC_ALL: 'C' }, opts)).not.toHaveProperty('LANG');
	});
	it('keeps HOME and PATH, or provides defaults', () => {
		expect(buildShellEnv({ HOME: '/x', PATH: '/p' }, opts)).toMatchObject({ HOME: '/x', PATH: '/p' });
		const env = buildShellEnv({}, opts);
		expect(env.HOME).toBe('/Users/me');
		expect(env.PATH).toContain('/usr/bin');
	});
});

describe('utf8Locale', () => {
	it('maps BCP 47 tags to installed locales', () => {
		expect(utf8Locale('it-IT', () => true)).toBe('it_IT.UTF-8');
		expect(utf8Locale('it', (n) => n === 'it_IT.UTF-8')).toBe('it_IT.UTF-8');
		expect(utf8Locale('en-GB', () => false)).toBe('en_US.UTF-8');
		expect(utf8Locale('', () => true)).toBe('en_US.UTF-8');
		expect(utf8Locale('../../etc', () => true)).toBe('en_US.UTF-8');
	});
});
