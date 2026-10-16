import { addIcon, FileSystemAdapter, Notice, Platform, Plugin, TFile, TFolder, View, type SplitDirection, type TAbstractFile, type WorkspaceLeaf } from 'obsidian';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { toHex, parseColor } from './color';
import { DEFAULT_SETTINGS, sanitizeSettings, type MacTerminalSettings } from './settings-data';
import { MacTerminalSettingTab } from './settings';
import { ICON, ICON_SVG } from './icon';
import type { Tag } from './tag';
import { TerminalView, VIEW_TYPE } from './terminal-view';

export default class MacTerminalPlugin extends Plugin {
	settings: MacTerminalSettings = { ...DEFAULT_SETTINGS };
	/** Open terminal views, so settings and theme changes reach all of them. */
	readonly views = new Set<TerminalView>();
	/**
	 * One-time tokens for terminals opened in this session. A view starts its shell
	 * by itself only with a valid token; tokens are never saved in the workspace.
	 */
	private readonly launchTokens = new Set<string>();

	async onload(): Promise<void> {
		if (!Platform.isMacOS || !Platform.isDesktopApp) {
			new Notice('Mac Terminal works only in Obsidian for macOS.');
			return;
		}
		await this.loadSettings();

		addIcon(ICON, ICON_SVG);
		this.registerView(VIEW_TYPE, (leaf) => new TerminalView(leaf, this));

		this.addRibbonIcon(ICON, 'Open terminal in current folder', () => this.openInCurrentFolder());
		this.addCommand({
			id: 'open-in-current-folder',
			name: 'Open terminal in current folder',
			callback: () => this.openInCurrentFolder(),
		});
		this.addCommand({
			id: 'open-in-vault-root',
			name: 'Open terminal in vault root',
			callback: () => this.openTerminal(this.app.vault.getRoot()),
		});
		this.addCommand({
			id: 'set-name-and-color',
			name: 'Set name and color of this terminal',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(TerminalView);
				if (!view) return false;
				if (!checking) view.editTag();
				return true;
			},
		});
		this.addCommand({
			id: 'toggle-black-background',
			name: 'Toggle black background',
			callback: () => this.toggleBlackBackground(),
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				const folder = folderOf(file);
				if (!folder) return;
				menu.addItem((item) =>
					item
						.setTitle('Open in terminal')
						.setIcon(ICON)
						.setSection('open')
						.onClick(() => this.openTerminal(folder)),
				);
			}),
		);
		this.registerEvent(this.app.workspace.on('css-change', () => this.refreshViews()));

		// Reloading the window keeps the renderer process alive: end the shells first.
		this.registerDomEvent(window, 'pagehide', () => this.stopAllShells());

		this.addSettingTab(new MacTerminalSettingTab(this.app, this));
	}

	onunload(): void {
		this.stopAllShells();
	}

	async loadSettings(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async updateSettings(patch: Partial<MacTerminalSettings>): Promise<void> {
		this.settings = sanitizeSettings({ ...this.settings, ...patch });
		await this.saveData(this.settings);
		this.refreshViews();
	}

	async toggleBlackBackground(): Promise<void> {
		await this.updateSettings({ blackBackground: !this.settings.blackBackground });
	}

	/** Absolute path of this plugin's folder, where the mt-pty helper lives. */
	pluginDir(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error('This vault is not on the local file system.');
		const dir = this.manifest.dir ?? path.join(this.app.vault.configDir, 'plugins', this.manifest.id);
		return path.join(adapter.getBasePath(), dir);
	}

	/** The theme's background colour, shown by the colour picker when no custom colour is set. */
	themeBackground(): string {
		const probe = document.body.createDiv({ cls: 'mac-terminal-probe' });
		probe.setCssProps({ color: 'var(--background-primary, #ffffff)' });
		const color = parseColor(getComputedStyle(probe).color);
		probe.remove();
		return color ? toHex(color) : '#ffffff';
	}

	/** True once for a token issued by openTerminal in this session. */
	consumeLaunchToken(token: unknown): boolean {
		return typeof token === 'string' && this.launchTokens.delete(token);
	}

	private refreshViews(): void {
		for (const view of this.views) view.applyAppearance();
	}

	private stopAllShells(): void {
		for (const view of this.views) view.stopShell();
	}

	/**
	 * Folder of the active terminal (a new terminal for the same project keeps its
	 * name and colour), else of the active note, else the vault root.
	 */
	private openInCurrentFolder(): Promise<void> {
		const active = this.app.workspace.getActiveViewOfType(TerminalView);
		const fromTerminal = active ? this.app.vault.getAbstractFileByPath((active.getState().folder as string) || '/') : null;
		if (active && fromTerminal instanceof TFolder) return this.openTerminal(fromTerminal, active.getTag());
		return this.openTerminal(this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot());
	}

	/**
	 * The pane a new split goes next to: the active one, unless it sits in a sidebar
	 * (the file explorer, after "Open in terminal"); then the note last worked on.
	 */
	private splitTarget(): WorkspaceLeaf | null {
		const workspace = this.app.workspace;
		const active = workspace.getActiveViewOfType(View)?.leaf ?? null;
		if (active) {
			const root = active.getRoot();
			if (root !== workspace.leftSplit && root !== workspace.rightSplit) return active;
		}
		return workspace.getMostRecentLeaf();
	}

	/**
	 * A split next to the note, without splitting the screen again and again: an empty
	 * pane is reused, and next to a terminal the new one becomes a tab in its group.
	 */
	private splitLeaf(direction: SplitDirection): WorkspaceLeaf {
		const workspace = this.app.workspace;
		const target = this.splitTarget();
		if (!target) return workspace.getLeaf('split', direction);
		const type = target.view.getViewType();
		if (type === 'empty') return target;
		// The target is the most recent leaf, which is where Obsidian adds a new tab.
		if (type === VIEW_TYPE) return workspace.getLeaf('tab');
		return workspace.createLeafBySplit(target, direction);
	}

	async openTerminal(folder: TFolder, tag?: Tag): Promise<void> {
		const workspace = this.app.workspace;
		let leaf: WorkspaceLeaf;
		switch (this.settings.openLocation) {
			case 'right':
				leaf = this.splitLeaf('vertical');
				break;
			case 'below':
				leaf = this.splitLeaf('horizontal');
				break;
			case 'window':
				leaf = workspace.getLeaf('window');
				break;
			default:
				leaf = workspace.getLeaf('tab');
		}
		const launch = randomUUID();
		this.launchTokens.add(launch);
		try {
			await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { folder: folder.isRoot() ? '' : folder.path, launch, ...tag } });
		} finally {
			this.launchTokens.delete(launch);
		}
		await workspace.revealLeaf(leaf);
	}
}

function folderOf(file: TAbstractFile): TFolder | null {
	if (file instanceof TFolder) return file;
	if (file instanceof TFile) return file.parent;
	return null;
}
