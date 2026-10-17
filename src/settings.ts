import { App, PluginSettingTab, Setting, requireApiVersion, type SettingDefinitionItem } from 'obsidian';
import { ICON } from './icon';
import type MacTerminalPlugin from './main';
import { BACKGROUNDS, DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, LOCATIONS, type Background, type MacTerminalSettings, type OpenLocation } from './settings-data';

const TEXT = {
	fontSize: ['Font size', 'Size of the terminal text, in pixels.'],
	background: ['Background', 'The first follows the Obsidian theme. Open terminals change right away, and text colors adjust to stay readable.'],
	banner: ['Startup art', 'Show the ninja octopus and the folder info when a terminal opens.'],
	location: ['Open terminals in', 'A split keeps the terminal next to the note you are working on.'],
} as const;

export class MacTerminalSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: MacTerminalPlugin) {
		super(app, plugin);
		if (requireApiVersion('1.11.0')) this.icon = ICON;
	}

	/** Obsidian 1.13+: declarative settings (searchable, rendered by Obsidian). */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: TEXT.fontSize[0],
				desc: TEXT.fontSize[1],
				control: { type: 'slider', key: 'fontSize', min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1, defaultValue: DEFAULT_SETTINGS.fontSize },
			},
			{
				name: TEXT.background[0],
				desc: TEXT.background[1],
				aliases: Object.values(BACKGROUNDS).map((b) => b.name),
				render: (setting) => this.renderBackground(setting),
			},
			{
				name: TEXT.banner[0],
				desc: TEXT.banner[1],
				control: { type: 'toggle', key: 'showBanner', defaultValue: DEFAULT_SETTINGS.showBanner },
			},
			{
				name: TEXT.location[0],
				desc: TEXT.location[1],
				control: { type: 'dropdown', key: 'openLocation', options: LOCATIONS, defaultValue: DEFAULT_SETTINGS.openLocation },
			},
		];
	}

	getControlValue(key: string): unknown {
		return Object.hasOwn(this.plugin.settings, key) ? this.plugin.settings[key as keyof MacTerminalSettings] : undefined;
	}

	/** Every change goes through the plugin, which validates it before saving. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return;
		await this.plugin.updateSettings({ [key]: value });
	}

	/** Obsidian before 1.13 renders the same settings imperatively. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName(TEXT.fontSize[0])
			.setDesc(TEXT.fontSize[1])
			.addSlider((slider) =>
				slider
					.setLimits(FONT_SIZE_MIN, FONT_SIZE_MAX, 1)
					.setValue(settings.fontSize)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ fontSize: value });
					}),
			);

		this.renderBackground(new Setting(containerEl).setName(TEXT.background[0]).setDesc(TEXT.background[1]));

		new Setting(containerEl)
			.setName(TEXT.banner[0])
			.setDesc(TEXT.banner[1])
			.addToggle((toggle) =>
				toggle.setValue(settings.showBanner).onChange(async (value) => {
					await this.plugin.updateSettings({ showBanner: value });
				}),
			);

		new Setting(containerEl)
			.setName(TEXT.location[0])
			.setDesc(TEXT.location[1])
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(LOCATIONS)
					.setValue(settings.openLocation)
					.onChange(async (value) => {
						await this.plugin.updateSettings({ openLocation: value as OpenLocation });
					}),
			);
	}

	/** One dot per background, as in the Name and color dialog; hovering shows the name. */
	private renderBackground(setting: Setting): void {
		setting.settingEl.addClass('mac-terminal-background-setting');
		const group =setting.controlEl.createDiv({ cls: 'mac-terminal-swatches', attr: { role: 'radiogroup', 'aria-label': TEXT.background[0] } });
		const ids = Object.keys(BACKGROUNDS) as Background[];
		const swatches = ids.map((id) => {
			const { name, color } = BACKGROUNDS[id];
			const swatch = group.createEl('button', {
				cls: color ? 'mac-terminal-swatch mac-terminal-background' : 'mac-terminal-swatch mac-terminal-background is-theme',
				attr: { type: 'button', role: 'radio', 'aria-label': name },
			});
			if (color) swatch.setCssProps({ '--mac-terminal-swatch': color });
			swatch.addEventListener('click', () => {
				void this.plugin.updateSettings({ background: id }).then(mark);
			});
			return swatch;
		});
		const mark = () => {
			for (const [i, swatch] of swatches.entries()) swatch.setAttr('aria-checked', String(ids[i] === this.plugin.settings.background));
		};
		mark();
	}
}
