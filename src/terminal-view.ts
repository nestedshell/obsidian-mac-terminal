import { FileSystemAdapter, ItemView, Menu, Notice, Scope, TFile, TFolder, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import * as fs from 'fs';
import * as os from 'os';
import { renderBanner } from './banner';
import { guardCountedSequences } from './guards';
import { ICON } from './icon';
import type MacTerminalPlugin from './main';
import { effectiveBackground } from './settings-data';
import { normalizeFolderPath, realPathOutside, resolveVaultFolder, vaultFileFromObsidianUrl } from './paths';
import { PtyError, PtySession, prepareHelper, type PtyExit } from './pty';
import { buildShellEnv, resolveShell, type ShellInfo } from './shell';
import { TAG_COLORS, sanitizeTag, tagColorVar, type Tag, type TagColor } from './tag';
import { TagModal } from './tag-modal';
import { capCombiningMarks, checkLink, quoteFlavor, quoteForShell, sanitizeForDisplay, sanitizePaste } from './text';
import { readAppearance, readThemeColor } from './theme';

export const VIEW_TYPE = 'mac-terminal';

/** Pause the shell when this many characters are waiting to be drawn… */
const FLOW_HIGH_WATER = 512 * 1024;
/** …and resume it once the backlog drops below this. */
const FLOW_LOW_WATER = 64 * 1024;
/** A shell that exits by itself this fast is shown as a failed start, even with code 0. */
const MIN_SESSION_MS = 1500;

/** Puts the terminal back in its normal modes before a new shell starts in it. */
const RESET_MODES =
	'\u001b[!p' + // soft reset: cursor, insert mode, margins, colours
	'\u001b[?1049l' + // leave the alternate screen a crashed full-screen program left on
	'\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1005l\u001b[?1006l\u001b[?1015l' + // mouse reporting off
	'\u001b[?1004l\u001b[?2004l\u001b[?1l\u001b>\u001b[?25h'; // focus reports, bracketed paste, cursor keys, keypad, cursor

const DIM = '\u001b[2m';
const RED = '\u001b[31m';
const RESET = '\u001b[0m';

/** ⌘ shortcuts the terminal handles itself; every other ⌘ shortcut stays with Obsidian. */
const TERMINAL_META_KEYS = new Set(['c', 'v', 'k', 'a', 'arrowleft', 'arrowright', 'backspace']);
/** Keys that type nothing on their own. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'Dead', 'Unidentified']);

/**
 * idle      not started yet (or restarting)
 * waiting   restored from the saved workspace: starts when the user presses Enter
 * running   the shell is alive
 * exited    the shell ended; Enter starts a new one
 * failed    the shell could not start; Enter tries again
 */
type SessionState = 'idle' | 'waiting' | 'running' | 'exited' | 'failed';

/** Parts of WorkspaceLeaf that aren't in the API; used only when present. */
interface LeafInternals {
	tabHeaderEl?: HTMLElement;
	tabHeaderInnerTitleEl?: HTMLElement;
	updateHeader?: () => void;
}

interface Frontend {
	term: Terminal;
	fit: FitAddon;
	opened: boolean;
	observer: ResizeObserver;
	disposables: IDisposable[];
}

export class TerminalView extends ItemView {
	navigation = false;

	private folder = '';
	private tag: Tag = { name: '', color: '' };
	private hostEl!: HTMLElement;
	private front: Frontend | null = null;
	private pty: PtySession | null = null;
	private shell: ShellInfo | null = null;
	private session: SessionState = 'idle';
	private stateReceived = false;
	private startRequested = false;
	private introShown = false;
	private closing = false;
	private startedAt = 0;
	/** The user typed or pasted into this session (xterm's automatic replies don't count). */
	private typed = false;
	/** Characters handed to xterm but not drawn yet (flow control). */
	private backlog = 0;
	private paused = false;
	/** Combining marks at the end of the last output chunk (see capCombiningMarks). */
	private markCarry = 0;
	private droppedInputAt = 0;
	private fitFrame = 0;
	private ptySize = { cols: 0, rows: 0 };

	constructor(leaf: WorkspaceLeaf, private readonly plugin: MacTerminalPlugin) {
		super(leaf);
		// While the terminal has focus, keys go to the shell: Obsidian hotkeys only
		// fire for ⌘ shortcuts (and Ctrl+Tab to switch tabs). Returning true claims
		// the key without preventing its default action, so xterm still receives it.
		this.scope = new Scope(this.app.scope);
		this.scope.register(null, null, (evt) => (this.ownsKey(evt) ? true : undefined));
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getIcon(): string {
		return ICON;
	}

	getDisplayText(): string {
		return this.tag.name || `Terminal: ${this.folderName()}`;
	}

	getState(): Record<string, unknown> {
		const state: Record<string, unknown> = { folder: this.folder };
		if (this.tag.name) state.name = this.tag.name;
		if (this.tag.color) state.color = this.tag.color;
		return state;
	}

	getTag(): Tag {
		return { ...this.tag };
	}

	/** Opens the dialog that names the tab and gives it a colour dot. */
	editTag(): void {
		new TagModal(this.app, this.tag, `Terminal: ${this.folderName()}`, (tag) => {
			this.tag = tag;
			this.showTag();
			this.app.workspace.requestSaveLayout();
			this.focus();
		}).open();
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem((item) =>
			item
				.setTitle('Name and color…')
				.setIcon('tag')
				.setSection('pane')
				.onClick(() => this.editTag()),
		);
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// The folder is fixed by the first state; later state changes are ignored.
		if (!this.stateReceived) {
			this.stateReceived = true;
			const data = (state ?? {}) as { folder?: unknown; launch?: unknown; name?: unknown; color?: unknown };
			this.folder = normalizeFolderPath(data.folder);
			this.tag = sanitizeTag(data);
			// ItemView writes the header title once, before the state arrives.
			this.showTag();
			// Only a terminal the user just opened starts by itself. One restored from
			// the saved workspace (which a synced or shared vault could have altered)
			// waits for Enter, so no shell ever starts in a folder nobody picked.
			if (this.plugin.consumeLaunchToken(data.launch)) this.requestStart();
			else this.session = 'waiting';
			this.scheduleFit();
		}
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('mac-terminal-view');
		this.hostEl = this.contentEl.createDiv({ cls: 'mac-terminal-host' });

		this.registerDomEvent(this.hostEl, 'paste', (evt) => this.onPaste(evt), { capture: true });
		this.registerDomEvent(this.hostEl, 'contextmenu', (evt) => this.onContextMenu(evt));
		this.registerDomEvent(this.hostEl, 'dragover', (evt) => this.onDragOver(evt));
		this.registerDomEvent(this.hostEl, 'drop', (evt) => this.onDrop(evt));
		// Dragging the tab to another window moves the DOM; xterm then needs to be
		// told about its new window. The terminal and its state stay as they are.
		this.register(this.contentEl.onWindowMigrated(() => this.moveToWindow()));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf === this.leaf) this.focus();
			}),
		);

		this.plugin.views.add(this);
		this.front = this.createFrontend();
		this.scheduleFit();
	}

	async onClose(): Promise<void> {
		this.closing = true;
		this.plugin.views.delete(this);
		// The leaf can go on showing another view: take the dot away.
		this.paintDot('');
		this.stopShell();
		this.disposeFrontend();
	}

	onResize(): void {
		this.scheduleFit();
	}

	/** Re-reads settings and theme; called when either changes. */
	applyAppearance(): void {
		if (!this.front) return;
		this.paintAppearance(this.front);
		this.scheduleFit();
	}

	private paintAppearance(front: Frontend): void {
		const look = readAppearance(this.contentEl, effectiveBackground(this.plugin.settings));
		this.contentEl.setCssProps({ '--mac-terminal-background': look.background });
		front.term.options.theme = look.theme;
		front.term.options.fontFamily = look.fontFamily;
		front.term.options.fontSize = this.plugin.settings.fontSize;
	}

	/** Ends the shell now (tab closed, plugin unloaded, app reloading). */
	stopShell(): void {
		const pty = this.pty;
		this.releasePty();
		pty?.close();
	}

	// ── Frontend (xterm) ─────────────────────────────────────────────────────

	private createFrontend(): Frontend {
		const look = readAppearance(this.contentEl, effectiveBackground(this.plugin.settings));
		this.contentEl.setCssProps({ '--mac-terminal-background': look.background });

		const term = new Terminal({
			allowProposedApi: true, // needed by the Unicode 11 width tables
			fontSize: this.plugin.settings.fontSize,
			fontFamily: look.fontFamily,
			theme: look.theme,
			cursorBlink: false, // like Terminal.app; blinking redraws keep ~3% CPU busy
			cursorStyle: 'block',
			cursorInactiveStyle: 'outline',
			scrollback: 10000,
			macOptionIsMeta: false, // Option must type characters: @ # [ ] on Italian keyboards
			macOptionClickForcesSelection: true,
			altClickMovesCursor: true,
			rightClickSelectsWord: false,
			drawBoldTextInBrightColors: true,
			// OSC 8 hyperlinks: the visible text can differ from the target, so the
			// real target is shown on hover and only ⌘-click opens it.
			linkHandler: {
				activate: (event, uri) => this.openLink(event, uri),
				hover: (_event, uri) => this.showLinkTarget(uri),
				leave: () => this.hideLinkTarget(),
				allowNonHttpProtocols: false,
			},
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new Unicode11Addon());
		term.unicode.activeVersion = '11';
		term.loadAddon(
			new WebLinksAddon((event, uri) => this.openLink(event, uri), {
				hover: (_event, uri) => this.showLinkTarget(uri),
				leave: () => this.hideLinkTarget(),
			}),
		);
		term.attachCustomKeyEventHandler((evt) => this.handleTermKey(evt));
		const guards = guardCountedSequences(term);

		const front: Frontend = {
			term,
			fit,
			opened: false,
			observer: this.observeSize(),
			disposables: [
				...guards,
				term.onData((data) => this.input(data)),
				term.onBinary((data) => this.input(Buffer.from(data, 'binary'))),
			],
		};
		// Fonts from themes or snippets can finish loading after the first measure.
		void this.hostEl.doc.fonts?.ready.then(() => {
			if (this.front === front) this.remeasure();
		});
		return front;
	}

	private observeSize(): ResizeObserver {
		// The observer must come from the window that shows the terminal.
		const RO = (this.hostEl.win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
		const observer = new RO(() => this.scheduleFit());
		observer.observe(this.hostEl);
		return observer;
	}

	/** Makes xterm measure the font again (new window, late-loading font). */
	private remeasure(): void {
		const term = this.front?.term;
		if (!term) return;
		const family = term.options.fontFamily ?? '';
		term.options.fontFamily = family + ' ';
		term.options.fontFamily = family;
		this.scheduleFit();
	}

	private moveToWindow(): void {
		const front = this.front;
		if (!front || this.closing) return;
		this.showTag();
		front.observer.disconnect();
		front.observer = this.observeSize();
		// Calling open() again on an opened terminal re-binds it to the new window
		// (the same mechanism VS Code uses); buffer, modes and the shell are untouched.
		if (front.opened) front.term.open(this.hostEl);
		this.fitFrame = 0; // a frame requested in the old window may never run
		this.remeasure();
	}

	private disposeFrontend(): void {
		const front = this.front;
		this.front = null;
		if (this.fitFrame) {
			this.hostEl?.win.cancelAnimationFrame(this.fitFrame);
			this.fitFrame = 0;
		}
		if (!front) return;
		front.observer.disconnect();
		for (const d of front.disposables) d.dispose();
		front.term.dispose();
		this.hostEl?.empty();
	}

	private scheduleFit(): void {
		if (this.fitFrame || !this.hostEl) return;
		this.fitFrame = this.hostEl.win.requestAnimationFrame(() => {
			this.fitFrame = 0;
			this.fitNow();
		});
	}

	private fitNow(): void {
		const front = this.front;
		if (!front || this.closing) return;
		// Hidden tabs have no size; xterm opens (and the shell starts) once visible.
		if (this.hostEl.clientWidth < 10 || this.hostEl.clientHeight < 10) return;
		if (!front.opened) {
			// A new split can create the view before Obsidian puts it in the window,
			// where theme colors can't be read yet: read them again now that it is there.
			this.paintAppearance(front);
			front.term.open(this.hostEl);
			front.opened = true;
		}
		const dims = front.fit.proposeDimensions();
		if (dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows) && dims.cols >= 2 && dims.rows >= 1) {
			if (dims.cols !== front.term.cols || dims.rows !== front.term.rows) front.term.resize(dims.cols, dims.rows);
		}
		if (this.session === 'waiting' && !this.introShown) {
			this.showIntro();
			const where = this.folder ? sanitizeForDisplay(this.folderLabel()) : 'the vault root';
			front.term.write(`${DIM}Press Enter to start a shell in ${where}.${RESET}\r\n`);
		}
		if (this.session === 'idle' && this.startRequested) this.launch();
		this.syncPtySize();
	}

	private syncPtySize(): void {
		const term = this.front?.term;
		if (!this.pty || !term) return;
		if (term.cols === this.ptySize.cols && term.rows === this.ptySize.rows) return;
		this.pty.resize(term.cols, term.rows);
		this.ptySize = { cols: term.cols, rows: term.rows };
	}

	private focus(): void {
		if (this.front?.opened) this.front.term.focus();
	}

	// ── Shell session ────────────────────────────────────────────────────────

	private requestStart(): void {
		this.session = 'idle';
		this.startRequested = true;
		this.scheduleFit();
	}

	/** The startup art, once per tab. */
	private showIntro(): void {
		const term = this.front?.term;
		if (!term || this.introShown) return;
		this.introShown = true;
		if (!this.plugin.settings.showBanner) return;
		const shell = (this.shell ??= resolveShell());
		const look = readAppearance(this.contentEl, effectiveBackground(this.plugin.settings));
		const color = this.tag.color;
		term.write(
			renderBanner({
				cols: term.cols,
				rows: term.rows,
				accent: look.accent,
				version: this.plugin.manifest.version,
				vault: this.app.vault.getName(),
				folder: this.folder || '/',
				link: this.realFolderOutside() ?? undefined,
				project: this.tag.name || color ? {
					name: this.tag.name || this.folderName(),
					color: color ? readThemeColor(this.contentEl, tagColorVar(color), TAG_COLORS[color].fallback) : null,
				} : undefined,
				shell: `${shell.name}${shell.args.includes('-l') ? ' (login)' : ''}`,
				system: systemDescription(),
			}),
		);
	}

	private launch(): void {
		const term = this.front?.term;
		if (!term || this.session !== 'idle' || this.closing) return;
		this.startRequested = false;

		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			this.fail('This vault is not on the local file system.');
			return;
		}
		const vaultRoot = adapter.getBasePath();
		let cwd = resolveVaultFolder(vaultRoot, this.folder);
		if (!isDirectory(cwd)) {
			term.write(`${DIM}Folder "${sanitizeForDisplay(this.folder)}" no longer exists, opening the vault root.${RESET}\r\n`);
			this.folder = '';
			cwd = resolveVaultFolder(vaultRoot, '');
		}
		if (!isDirectory(cwd)) cwd = os.homedir();

		let helper: string;
		try {
			helper = prepareHelper();
		} catch (error) {
			this.fail(error instanceof PtyError ? error.message : String(error));
			return;
		}

		this.shell = resolveShell();
		this.showIntro();

		let pty: PtySession;
		try {
			pty = new PtySession(helper, {
				file: this.shell.file,
				args: this.shell.args,
				cols: term.cols,
				rows: term.rows,
				cwd,
				env: buildShellEnv(process.env, {
					shell: this.shell.file,
					home: os.homedir(),
					locale: navigator.language,
					version: this.plugin.manifest.version,
				}),
			});
		} catch (error) {
			this.fail(`Could not start ${this.shell.file}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}

		this.pty = pty;
		this.ptySize = { cols: term.cols, rows: term.rows };
		this.session = 'running';
		this.startedAt = Date.now();
		this.typed = false;
		this.markCarry = 0;
		pty.onData((data) => this.output(data));
		pty.onExit((exit) => this.onExit(pty, exit));
		this.app.workspace.requestSaveLayout();
		this.focus();
	}

	private onExit(pty: PtySession, exit: PtyExit): void {
		if (pty !== this.pty) return;
		const lived = Date.now() - this.startedAt;
		this.releasePty();
		if (this.closing) return;
		// Ending the shell yourself (`exit`, Ctrl+D) closes the tab whatever the code:
		// `exit` returns the status of the last command. A shell killed by a signal, or
		// one that ends on its own, keeps the tab open with the reason.
		if (exit.signal === null && (this.typed || (exit.code === 0 && lived >= MIN_SESSION_MS))) {
			this.leaf.detach();
			return;
		}
		this.session = 'exited';
		const term = this.front?.term;
		if (!term) return;
		if (exit.message) term.write(`\r\n${RED}${sanitizeForDisplay(exit.message)}${RESET}`);
		const reason = exit.signal ? `ended by ${exit.signal}` : `exited with code ${exit.code}`;
		term.write(`\r\n${DIM}[Process ${reason}]${RESET} Press Enter to restart, or ⌘W to close.\r\n`);
	}

	private fail(message: string): void {
		this.session = 'failed';
		this.startRequested = false;
		this.front?.term.write(`\r\n${RED}${sanitizeForDisplay(message)}${RESET}\r\n${DIM}Press Enter to try again.${RESET}\r\n`);
		new Notice(`Terminal: ${message}`, 10000);
	}

	private releasePty(): void {
		this.pty = null;
		this.backlog = 0;
		this.paused = false;
		if (this.session === 'running') this.session = 'idle';
	}

	/** Shell output → screen, pausing the shell when xterm falls behind. */
	private output(chunk: string): void {
		const term = this.front?.term;
		if (!term) return;
		const { text: data, carry } = capCombiningMarks(chunk, this.markCarry);
		this.markCarry = carry;
		this.backlog += data.length;
		term.write(data, () => {
			this.backlog = Math.max(0, this.backlog - data.length);
			if (this.paused && this.backlog < FLOW_LOW_WATER) this.setPaused(false);
		});
		if (!this.paused && this.backlog > FLOW_HIGH_WATER) this.setPaused(true);
	}

	private setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		if (paused) this.pty?.pause();
		else this.pty?.resume();
	}

	/** Keyboard (and paste) → shell; Enter (re)starts a shell that isn't running. */
	private input(data: string | Buffer): void {
		if (this.session === 'running' && this.pty) {
			if (!this.pty.write(data) && Date.now() - this.droppedInputAt > 10000) {
				this.droppedInputAt = Date.now();
				new Notice('Terminal: the program is not reading input, so typing is being dropped.');
			}
			return;
		}
		if (this.session !== 'idle' && typeof data === 'string' && data.includes('\r')) {
			if (this.session === 'exited' || this.session === 'failed') this.front?.term.write(`${RESET_MODES}\r\n`);
			this.requestStart();
		}
	}

	// ── Keyboard, clipboard, mouse ───────────────────────────────────────────

	private ownsKey(evt: KeyboardEvent): boolean {
		const target = evt.target as Node | null;
		if (!target || typeof target.nodeType !== 'number' || !this.hostEl?.contains(target)) return false;
		if (evt.ctrlKey && evt.key === 'Tab') return false;
		if (evt.metaKey) return !evt.ctrlKey && !evt.altKey && !evt.shiftKey && TERMINAL_META_KEYS.has(evt.key.toLowerCase());
		return true;
	}

	/** Returning false stops xterm from handling the key. */
	private handleTermKey(evt: KeyboardEvent): boolean {
		const term = this.front?.term;
		if (!term) return false;
		const plainMeta = evt.metaKey && !evt.ctrlKey && !evt.altKey && !evt.shiftKey;
		const plainAlt = evt.altKey && !evt.metaKey && !evt.ctrlKey && !evt.shiftKey;

		if (evt.type === 'keydown') {
			if (!evt.metaKey && !MODIFIER_KEYS.has(evt.key)) this.markTyped();
			const send = (sequence: string) => {
				evt.preventDefault();
				this.markTyped();
				this.input(sequence);
				return false;
			};
			if (plainMeta) {
				switch (evt.key.toLowerCase()) {
					case 'c':
						evt.preventDefault();
						if (term.hasSelection()) this.copySelection();
						return false;
					case 'v':
						return false; // the paste event that follows is handled in onPaste
					case 'k':
						evt.preventDefault();
						term.clear();
						return false;
					case 'a':
						evt.preventDefault();
						term.selectAll();
						return false;
					case 'arrowleft':
						return send('\u0001'); // start of line
					case 'arrowright':
						return send('\u0005'); // end of line
					case 'backspace':
						return send('\u0015'); // delete to start of line
				}
			}
			if (plainAlt) {
				if (evt.key === 'ArrowLeft') return send('\u001bb'); // word left
				if (evt.key === 'ArrowRight') return send('\u001bf'); // word right
			}
			// Shift+Enter: newline without submitting (zsh, Claude Code and other TUIs).
			if (evt.key === 'Enter' && evt.shiftKey && !evt.metaKey && !evt.ctrlKey && !evt.altKey) return send('\u001b\r');
		}
		if (evt.metaKey) return false;
		if (evt.ctrlKey && evt.key === 'Tab') return false;
		return true;
	}

	private markTyped(): void {
		if (this.session === 'running') this.typed = true;
	}

	/** The clipboard of the window that shows the terminal (popouts have their own). */
	private clipboard(): Clipboard {
		return this.hostEl.win.navigator.clipboard;
	}

	private copySelection(): void {
		const text = this.front?.term.getSelection() ?? '';
		if (!text) return;
		this.clipboard()
			.writeText(text)
			.catch(() => new Notice('Terminal: could not copy to the clipboard.'));
	}

	private pasteText(text: string): void {
		const clean = sanitizePaste(text);
		if (!clean || !this.front) return;
		this.markTyped();
		this.front.term.paste(clean);
	}

	private onPaste(evt: ClipboardEvent): void {
		evt.preventDefault();
		evt.stopPropagation();
		this.pasteText(evt.clipboardData?.getData('text/plain') ?? '');
	}

	private onContextMenu(evt: MouseEvent): void {
		const term = this.front?.term;
		if (!term) return;
		evt.preventDefault();
		evt.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('Copy').setIcon('copy').setDisabled(!term.hasSelection()).onClick(() => this.copySelection()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Paste')
				.setIcon('clipboard-paste')
				.onClick(() => {
					this.clipboard()
						.readText()
						.then((text) => this.pasteText(text))
						.catch(() => new Notice('Terminal: could not read the clipboard.'));
				}),
		);
		menu.addItem((item) => item.setTitle('Select all').setIcon('text-select').onClick(() => term.selectAll()));
		menu.addItem((item) => item.setTitle('Clear').setIcon('eraser').onClick(() => term.clear()));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle('Name and color…').setIcon('tag').onClick(() => this.editTag()));
		menu.addItem((item) =>
			item
				.setTitle('Black background')
				.setIcon('moon')
				.setChecked(this.plugin.settings.background === 'black')
				.onClick(() => void this.plugin.toggleBackground('black')),
		);
		menu.addItem((item) =>
			item
				.setTitle('White background')
				.setIcon('sun')
				.setChecked(this.plugin.settings.background === 'white')
				.onClick(() => void this.plugin.toggleBackground('white')),
		);
		menu.showAtMouseEvent(evt);
	}

	private onDragOver(evt: DragEvent): void {
		if (!evt.dataTransfer) return;
		evt.preventDefault();
		evt.stopPropagation();
		evt.dataTransfer.dropEffect = 'copy';
	}

	/** Dropping files (from Finder or from Obsidian) types their quoted paths. */
	private onDrop(evt: DragEvent): void {
		const data = evt.dataTransfer;
		if (!data) return;
		evt.preventDefault();
		evt.stopPropagation();

		const paths: string[] = [];
		for (const file of Array.from(data.files)) {
			const filePath = pathForDroppedFile(file);
			if (filePath) paths.push(filePath);
		}
		if (paths.length === 0) {
			const text = data.getData('text/plain');
			const links = text.split('\n').map((l) => l.trim()).filter(Boolean);
			const resolved = links.map((link) => this.vaultPathFromLink(link));
			if (links.length === 0) return;
			if (resolved.every((p): p is string => p !== null)) paths.push(...resolved);
			else {
				this.pasteText(text);
				this.focus();
				return;
			}
		}

		const flavor = quoteFlavor((this.shell ??= resolveShell()).name);
		const quoted = paths.map((p) => quoteForShell(p, flavor));
		if (quoted.some((q) => q === null)) new Notice('Terminal: skipped a file name with invisible or control characters.');
		const words = quoted.filter((q): q is string => q !== null);
		if (words.length > 0) this.pasteText(words.join(' ') + ' ');
		this.focus();
	}

	private vaultPathFromLink(link: string): string | null {
		const rel = vaultFileFromObsidianUrl(link, this.app.vault.getName());
		if (!rel) return null;
		const file = this.app.vault.getAbstractFileByPath(rel) ?? this.app.vault.getAbstractFileByPath(`${rel}.md`);
		const adapter = this.app.vault.adapter;
		if (!(file instanceof TFile || file instanceof TFolder) || !(adapter instanceof FileSystemAdapter)) return null;
		return resolveVaultFolder(adapter.getBasePath(), file.path);
	}

	private showLinkTarget(uri: string): void {
		const link = checkLink(uri);
		this.hostEl.setAttr('title', link.open ? `${link.label}\n⌘-click to open` : link.label);
	}

	private hideLinkTarget(): void {
		this.hostEl.removeAttribute('title');
	}

	/** Only ⌘-click opens links, and only http(s) links, in the default browser. */
	private openLink(event: MouseEvent, uri: string): void {
		if (!event.metaKey) return;
		const link = checkLink(uri);
		if (link.open) window.open(link.href);
		else new Notice(`Terminal: ${link.label}`);
	}

	// ── Name and colour dot ──────────────────────────────────────────────────

	/** Where the folder really is, when a symbolic link leads out of the vault. */
	private realFolderOutside(): string | null {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return null;
		const root = adapter.getBasePath();
		return realPathOutside(root, resolveVaultFolder(root, this.folder));
	}

	/** The folder as shown to the user, with its real place when a link leads out of the vault. */
	private folderLabel(): string {
		const outside = this.realFolderOutside();
		return outside ? `${this.folder} (links to ${outside})` : this.folder;
	}

	private folderName(): string {
		return this.folder ? (this.folder.split('/').pop() ?? this.folder) : this.app.vault.getName();
	}

	/** Shows the name in the tab and the header, and the colour dot next to it. */
	private showTag(): void {
		const leaf = this.leaf as unknown as LeafInternals;
		this.paintDot(this.tag.color);
		const title = this.getDisplayText();
		(this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(title);
		if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
		else leaf.tabHeaderInnerTitleEl?.setText(title);
	}

	private paintDot(color: TagColor | ''): void {
		const leaf = this.leaf as unknown as LeafInternals;
		for (const el of [this.containerEl, leaf.tabHeaderEl]) {
			if (!el || typeof el.toggleClass !== 'function') continue;
			el.toggleClass('mac-terminal-tagged', color !== '');
			el.setCssProps({ '--mac-terminal-tag': color ? `var(${tagColorVar(color)})` : '' });
		}
	}
}

function isDirectory(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

function systemDescription(): string {
	const proc = process as NodeJS.Process & { getSystemVersion?: () => string };
	const version = typeof proc.getSystemVersion === 'function' ? proc.getSystemVersion() : '';
	const arch = process.arch === 'arm64' ? 'Apple silicon' : 'Intel';
	return version ? `macOS ${version} · ${arch}` : `macOS · ${arch}`;
}

/** Real path of a file dropped from Finder (Electron removed File.path in v32). */
function pathForDroppedFile(file: File): string | null {
	try {
		const nodeRequire = (window as unknown as { require?: NodeJS.Require }).require;
		const electron = nodeRequire?.('electron') as { webUtils?: { getPathForFile(file: File): string } } | undefined;
		const p = electron?.webUtils?.getPathForFile(file);
		if (p) return p;
	} catch {
		// Not available: fall through.
	}
	const legacy = (file as File & { path?: unknown }).path;
	return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
}
