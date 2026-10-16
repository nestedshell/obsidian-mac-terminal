import { App, PluginSettingTab, Setting, requireApiVersion, type SettingDefinitionItem } from 'obsidian';
import { isHexColor } from './color';
import { ICON } from './icon';
import type MacTerminalPlugin from './main';
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, LOCATIONS, type MacTerminalSettings, type OpenLocation } from './settings-data';

const TEXT = {
	fontSize: ['Font size', 'Size of the terminal text, in pixels.'],
	black: ['Black background', 'Pure black, like a classic terminal. Turn it off to go back to the color below.'],
	background: ['Background color', 'Follows the Obsidian theme until you pick a color. Text color adjusts to stay readable.'],
	banner: ['Startup art', 'Show the ninja octopus and the folder info when a terminal opens.'],
	location: ['Open terminals in', 'Where new terminals appear.'],
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
				name: TEXT.black[0],
				desc: TEXT.black[1],
				control: { type: 'toggle', key: 'blackBackground', defaultValue: DEFAULT_SETTINGS.blackBackground },
			},
			{
				name: TEXT.background[0],
				desc: TEXT.background[1],
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

		new Setting(containerEl)
			.setName(TEXT.black[0])
			.setDesc(TEXT.black[1])
			.addToggle((toggle) =>
				toggle.setValue(settings.blackBackground).onChange(async (value) => {
					await this.plugin.updateSettings({ blackBackground: value });
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

	/** Color picker plus a button back to the theme color ("" in the settings). */
	private renderBackground(setting: Setting): void {
		let picker: { setValue(value: string): unknown } | null = null;
		// ColorComponent.setValue calls onChange synchronously; showing the theme color
		// after a reset must not save it as a custom color.
		let showingThemeColor = false;
		setting
			.addColorPicker((color) => {
				picker = color;
				color.setValue(this.plugin.settings.background || this.plugin.themeBackground()).onChange(async (value) => {
					if (showingThemeColor || !isHexColor(value)) return;
					await this.plugin.updateSettings({ background: value.toLowerCase() });
				});
			})
			.addExtraButton((button) =>
				button
					.setIcon('rotate-ccw')
					.setTooltip('Use the theme background')
					.onClick(async () => {
						await this.plugin.updateSettings({ background: '' });
						showingThemeColor = true;
						try {
							picker?.setValue(this.plugin.themeBackground());
						} finally {
							showingThemeColor = false;
						}
					}),
			);
	}
}
