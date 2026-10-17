// The plugin icon: the nestedshell ninja octopus, as in the startup art.
// Static SVG content for Obsidian's 100×100 icon box; no user data goes in here.
export const ICON = 'mac-terminal-octopus';

export const ICON_SVG =
	'<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
	// Head, its lower edge, and four curled arms.
	'<path d="M22 56C20 30 33 10 50 10C67 10 80 30 78 56"/>' +
	'<path d="M22 56C34 62 66 62 78 56"/>' +
	'<path d="M22 56C18 66 10 70 8 80C7 86 12 90 17 86"/>' +
	'<path d="M38 60C36 72 30 80 30 90"/>' +
	'<path d="M62 60C64 72 70 80 70 90"/>' +
	'<path d="M78 56C82 66 90 70 92 80C93 86 88 90 83 86"/>' +
	// The knot of the headband.
	'<path d="M80 33L93 25"/>' +
	'<path d="M80 39L94 46"/>' +
	'</g>' +
	// The headband, with angry eyes cut out of it.
	'<path fill="currentColor" fill-rule="evenodd" d="M20 27H80V50H20Z M30 36L45 41A7 7 0 0 1 31 43Z M70 36L55 41A7 7 0 0 0 69 43Z"/>';
