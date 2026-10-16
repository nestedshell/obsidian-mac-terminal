import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Shells that understand `-l` (start as a login shell, like Terminal.app does). */
const LOGIN_SHELLS = new Set(['bash', 'zsh', 'sh', 'ksh', 'mksh', 'dash', 'fish', 'tcsh', 'csh', 'nu']);

/**
 * Variables that describe another terminal (the one Obsidian may have been started
 * from) or Obsidian's own process (bundle id, XPC service, Electron's allocator
 * and logging tweaks), not a shell in this terminal.
 */
const STALE_TERMINAL_VARS = [
	'__CFBundleIdentifier', 'XPC_SERVICE_NAME', 'MallocNanoZone', 'OSLogRateLimit', 'ORIGINAL_XDG_CURRENT_DESKTOP',
	'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'TERMCAP', 'COLORTERM',
	'COLUMNS', 'LINES', 'WINDOWID', 'TMUX', 'TMUX_PANE', 'STY', 'WINDOW', 'SHLVL', 'OLDPWD', '_',
	'LC_TERMINAL', 'LC_TERMINAL_VERSION', 'COLORFGBG', 'TERM_FEATURES',
];
const STALE_TERMINAL_PREFIXES = ['ITERM_', 'VSCODE_', 'KITTY_', 'WEZTERM_', 'GHOSTTY_', 'ALACRITTY_', 'ELECTRON_', 'CHROME_'];

export interface ShellInfo {
	/** Absolute path of the shell executable. */
	file: string;
	/** Arguments passed to the shell. */
	args: string[];
	/** Short name, e.g. "zsh". */
	name: string;
}

export function isExecutableFile(file: string): boolean {
	try {
		if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) return false;
		fs.accessSync(file, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * The user's login shell, the same one Terminal.app opens: the account's shell
 * from the user database first ($SHELL can be missing when Obsidian is started
 * from the Dock), then $SHELL, then the macOS default.
 */
export function resolveShell(
	candidates: Array<string | undefined> = [safeUserShell(), process.env.SHELL],
	isExecutable: (file: string) => boolean = isExecutableFile,
): ShellInfo {
	const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];
	const file = [...candidates, ...fallbacks].find((c): c is string => typeof c === 'string' && c.length > 0 && isExecutable(c)) ?? '/bin/sh';
	const name = path.basename(file);
	return { file, name, args: LOGIN_SHELLS.has(name) ? ['-l'] : [] };
}

function safeUserShell(): string | undefined {
	try {
		return os.userInfo().shell ?? undefined;
	} catch {
		return undefined;
	}
}

export interface EnvOptions {
	shell: string;
	home: string;
	/** BCP 47 locale of the app, e.g. "it-IT". Used only when no locale is set. */
	locale: string;
	version: string;
	/** Tells whether a locale like "it_IT.UTF-8" is installed. */
	localeExists?: (name: string) => boolean;
}

/**
 * Environment for the shell: Obsidian's own environment, minus variables that
 * belong to another terminal or to Electron, plus what a terminal must provide.
 */
export function buildShellEnv(base: Record<string, string | undefined>, opts: EnvOptions): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(base)) {
		if (typeof value !== 'string' || key === '' || key.includes('=') || value.includes('\0')) continue;
		if (STALE_TERMINAL_VARS.includes(key) || STALE_TERMINAL_PREFIXES.some((p) => key.startsWith(p))) continue;
		env[key] = value;
	}

	env.TERM = 'xterm-256color';
	env.COLORTERM = 'truecolor';
	env.TERM_PROGRAM = 'mac-terminal';
	env.TERM_PROGRAM_VERSION = opts.version;
	env.SHELL = opts.shell;
	if (!env.HOME) env.HOME = opts.home;
	if (!env.PATH) env.PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

	// Apps started from the Dock get no locale. Without one, zsh and ls print
	// accented file names as escape codes, so pick a UTF-8 locale like Terminal.app.
	if (!env.LC_ALL && !env.LC_CTYPE && !env.LANG) {
		env.LANG = utf8Locale(opts.locale, opts.localeExists ?? macLocaleExists);
	}
	return env;
}

export function utf8Locale(bcp47: string, exists: (name: string) => boolean): string {
	const match = /^([a-z]{2,3})(?:[-_]([A-Z]{2}))?/i.exec(bcp47 || '');
	if (match) {
		const lang = match[1].toLowerCase();
		const region = match[2]?.toUpperCase();
		const candidates = region ? [`${lang}_${region}.UTF-8`] : [];
		candidates.push(`${lang}_${lang.toUpperCase()}.UTF-8`);
		for (const candidate of candidates) if (exists(candidate)) return candidate;
	}
	return 'en_US.UTF-8';
}

function macLocaleExists(name: string): boolean {
	if (!/^[a-z]{2,3}_[A-Z]{2}\.UTF-8$/.test(name)) return false;
	try {
		return fs.statSync(path.join('/usr/share/locale', name)).isDirectory();
	} catch {
		return false;
	}
}
