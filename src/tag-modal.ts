import { App, Modal, Setting } from 'obsidian';
import { TAG_COLORS, TAG_NAME_MAX, sanitizeTag, tagColorVar, type Tag, type TagColor } from './tag';

/** Asks for the name and the colour dot of a terminal tab. */
export class TagModal extends Modal {
	private name: string;
	private color: TagColor | '';

	constructor(
		app: App,
		tag: Tag,
		private readonly placeholder: string,
		private readonly onSave: (tag: Tag) => void,
	) {
		super(app);
		this.name = tag.name;
		this.color = tag.color;
	}

	onOpen(): void {
		this.setTitle('Name and color');
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Shown in the tab instead of the folder name.')
			.addText((text) => {
				text.setPlaceholder(this.placeholder).setValue(this.name).onChange((value) => (this.name = value));
				text.inputEl.maxLength = TAG_NAME_MAX * 2;
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter' && !evt.isComposing) {
						evt.preventDefault();
						this.save();
					}
				});
				window.setTimeout(() => text.inputEl.select(), 0);
			});

		const colors = new Setting(contentEl).setName('Color').setDesc('A dot in the tab, to spot it at a glance.');
		const group = colors.controlEl.createDiv({ cls: 'mac-terminal-swatches', attr: { role: 'radiogroup', 'aria-label': 'Color' } });
		const swatches: HTMLButtonElement[] = [];
		const options: Array<TagColor | ''> = ['', ...(Object.keys(TAG_COLORS) as TagColor[])];
		for (const option of options) {
			const swatch = group.createEl('button', {
				cls: option ? 'mac-terminal-swatch' : 'mac-terminal-swatch is-none',
				attr: { type: 'button', role: 'radio', 'aria-label': option ? TAG_COLORS[option].label : 'No color' },
			});
			if (option) swatch.setCssProps({ '--mac-terminal-swatch': `var(${tagColorVar(option)})` });
			swatch.addEventListener('click', () => {
				this.color = option;
				for (const [i, s] of swatches.entries()) s.setAttr('aria-checked', String(options[i] === option));
			});
			swatch.setAttr('aria-checked', String(option === this.color));
			swatches.push(swatch);
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText('Save').setCta().onClick(() => this.save()))
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private save(): void {
		this.onSave(sanitizeTag({ name: this.name, color: this.color }));
		this.close();
	}
}
