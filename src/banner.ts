// The startup art: the nestedshell ninja octopus, drawn with coloured cells, next
// to a short info panel. Pure function, no DOM.
import { BLACK, WHITE, mix, type Rgb } from './color';
import { displayWidth, sanitizeForDisplay, stripAnsi, truncateToWidth } from './text';

export interface BannerInfo {
	cols: number;
	rows: number;
	accent: Rgb;
	dark: boolean;
	/** Terminal background, so the octopus stays visible on dark themes. */
	background: Rgb;
	version: string;
	vault: string;
	folder: string;
	shell: string;
	system: string;
	/** Where the folder really is, when a symbolic link leads out of the vault. */
	link?: string;
	/** Name and colour dot the user gave the terminal. */
	project?: { name: string; color: Rgb | null };
}

const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const fg = (c: Rgb) => `${ESC}38;2;${Math.round(c.r)};${Math.round(c.g)};${Math.round(c.b)}m`;
const bg = (c: Rgb) => `${ESC}48;2;${Math.round(c.r)};${Math.round(c.g)};${Math.round(c.b)}m`;
const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b, a: 1 });

/**
 * The octopus, one character per terminal cell (cells are twice as tall as wide):
 * K body, F face, W eye, p pupil, < > angry brows, o sucker, . nothing.
 */
const OCTOPUS = [
	'..........KKKKKKKK....KKK...',
	'........KKKKKKKKKKKK....KK..',
	'.......KKKKKKKKKKKKKK...KK..',
	'......KFFWW<FFFF>WWFFK.KK...',
	'......KFFWpWFFFFWpWFFKKK....',
	'.KK....KKKKKKKKKKKKKKK......',
	'.KoKKKKKKKKKKKKKKKKKKKKoKKK.',
	'...KKoKKKKKKKKKKKKKKKKK..KK.',
	'......KK..KK....KK..KK......',
	'.....KK...Ko....oK...KK.....',
	'...KKo....KK....KK....oKK...',
	'...K.......KK..KK.......K...',
];
export const ART_WIDTH = OCTOPUS[0].length;
const FACE = rgb(246, 212, 178);
const EYE = rgb(250, 250, 250);
const INK = rgb(18, 18, 18);

const MARGIN = '  ';
const GAP = '   ';
const LABEL_WIDTH = 8;
const CREDIT = 'by nestedshell';
const HINT = '⌘K clear · ⌘-click opens a link';
/** Narrowest terminal that fits the octopus plus a readable info panel. */
export const WIDE_LAYOUT_MIN_COLS = 64;

/**
 * Draws the octopus with coloured spaces (and a few glyphs for eyes and suckers):
 * background colours fill whole cells, so the art stays crisp whatever the font.
 * The ninja is black; on a dark background it turns charcoal so it stays visible.
 */
export function renderOctopus(background: Rgb, dark: boolean): string[] {
	const body = dark ? mix(background, WHITE, 0.22) : rgb(22, 22, 22);
	const sucker = dark ? mix(body, WHITE, 0.5) : rgb(140, 140, 140);
	const cells: Record<string, string> = {
		K: `${bg(body)} `,
		F: `${bg(FACE)} `,
		W: `${bg(EYE)} `,
		p: `${bg(EYE)}${fg(INK)}●`,
		'<': `${bg(EYE)}${fg(INK)}◥`,
		'>': `${bg(EYE)}${fg(INK)}◤`,
		o: `${bg(body)}${fg(sucker)}•`,
	};
	return OCTOPUS.map((line) => Array.from(line, (k) => (cells[k] ? cells[k] + RESET : ' ')).join(''));
}

interface Panel {
	title: string;
	credit: string;
	folder: string;
	lines: string[];
}

function infoPanel(info: BannerInfo, width: number): Panel {
	const accentText = fg(info.dark ? mix(info.accent, WHITE, 0.25) : mix(info.accent, BLACK, 0.15));
	const label = (name: string) => `${accentText}${BOLD}${name.padEnd(LABEL_WIDTH)}${RESET}`;
	const value = (text: string, keepEnd = false) => truncateToWidth(sanitizeForDisplay(text), Math.max(1, width - LABEL_WIDTH), keepEnd);
	const name = 'mac-terminal';
	const version = ` v${sanitizeForDisplay(info.version)}`;
	const title = displayWidth(name + version) <= width
		? `${accentText}${BOLD}${name}${RESET}${DIM}${version}${RESET}`
		: `${accentText}${BOLD}${truncateToWidth(name, width)}${RESET}`;
	const credit = displayWidth(CREDIT) <= width ? `${DIM}${CREDIT}${RESET}` : '';

	let project = '';
	if (info.project) {
		const dot = info.project.color ? `${fg(info.project.color)}●${RESET} ` : '';
		const room = Math.max(1, width - LABEL_WIDTH - (dot ? 2 : 0));
		project = `${label('project')}${dot}${BOLD}${truncateToWidth(sanitizeForDisplay(info.project.name), room)}${RESET}`;
	}
	const folder = `${label('folder')}${value(info.folder, true)}`;
	const link = info.link ? `${label('link to')}${value(info.link, true)}` : '';
	const details = [project, `${label('vault')}${value(info.vault)}`, folder, link, `${label('shell')}${value(info.shell)}`, `${label('system')}${value(info.system)}`].filter(Boolean);
	// The rule under the title is as long as the longest line of the panel.
	const rule = Math.min(width, Math.max(...[title, credit, ...details].map((line) => displayWidth(stripAnsi(line)))));
	return {
		title,
		credit,
		folder,
		lines: [
			title,
			...(credit ? [credit] : []),
			`${DIM}${'─'.repeat(rule)}${RESET}`,
			...details,
			'',
			`${DIM}${truncateToWidth(HINT, width)}${RESET}`,
		],
	};
}

/** The text written to the terminal before the shell starts, with CRLF line ends. */
export function renderBanner(info: BannerInfo): string {
	const cols = Math.floor(info.cols);
	// Too narrow for anything readable: skip the art rather than wrap it.
	if (!Number.isFinite(cols) || cols < 8) return '';
	let lines: string[];

	if (cols >= WIDE_LAYOUT_MIN_COLS && info.rows >= 14) {
		const art = renderOctopus(info.background, info.dark);
		const panelWidth = cols - MARGIN.length - ART_WIDTH - GAP.length - 1;
		const panel = infoPanel(info, Math.min(panelWidth, 48)).lines;
		const offset = Math.max(0, Math.floor((art.length - panel.length) / 2));
		lines = art.map((a, i) => `${MARGIN}${a}${GAP}${panel[i - offset] ?? ''}${RESET}`);
	} else {
		// Compact layout for narrow panes: a small diamond, the title and the folder.
		const width = Math.max(1, cols - MARGIN.length - 1);
		const withDiamond = width >= 16;
		const textWidth = withDiamond ? width - 2 : width;
		const panel = infoPanel({ ...info, project: undefined }, textWidth);
		const diamond = withDiamond ? `${fg(info.project?.color ?? info.accent)}◆${RESET} ` : '';
		let title = info.project ? `${BOLD}${truncateToWidth(sanitizeForDisplay(info.project.name), textWidth)}${RESET}` : panel.title;
		if (!info.project && displayWidth(stripAnsi(title)) + 2 + displayWidth(CREDIT) <= textWidth) title += `  ${DIM}${CREDIT}${RESET}`;
		lines = [`${MARGIN}${diamond}${title}`];
		if (width >= 12) lines.push(`${MARGIN}${withDiamond ? '  ' : ''}${panel.folder}`);
	}
	return '\r\n' + lines.join('\r\n') + '\r\n\r\n';
}
