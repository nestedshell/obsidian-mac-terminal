// Builds the plugin into dist/mac-terminal/:
//   main.js       the bundled plugin (xterm.js included)
//   styles.css    xterm.css + src/styles.css
//   manifest.json
//   mt-pty        the pseudo-terminal helper (native/mt-pty.c), universal binary
// The SHA-256 of mt-pty is baked into main.js and checked before every use.
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { compileHelper } from './helper.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, 'dist', manifest.id);
const watch = process.argv.includes('--watch');

function writeStatic() {
	const css = [
		'/* xterm.js, MIT License, Copyright (c) The xterm.js authors */',
		fs.readFileSync(path.join(root, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'), 'utf8'),
		fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8'),
	].join('\n');
	fs.writeFileSync(path.join(out, 'styles.css'), css);
	fs.copyFileSync(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));
}

/**
 * xterm.js decides "am I on a Mac?" from navigator.platform, unless `process` exists,
 * in which case it assumes Node.js and reports no platform at all. Obsidian has
 * `process`, so without this fix xterm treats Option as Meta and you can't type
 * @ # [ ] { } on an Italian keyboard. The check is replaced with `false`; the build
 * stops if a new xterm version no longer contains it exactly once.
 */
const xtermPlatformFix = {
	name: 'xterm-platform-fix',
	setup(build) {
		build.onLoad({ filter: /[\\/]@xterm[\\/]xterm[\\/]lib[\\/]xterm\.m?js$/ }, async (args) => {
			const source = await fs.promises.readFile(args.path, 'utf8');
			const needle = 'typeof process<"u"&&"title"in process';
			const count = source.split(needle).length - 1;
			if (count !== 1) throw new Error(`xterm platform check found ${count} times in ${args.path}: review xtermPlatformFix`);
			return { contents: source.replace(needle, '!1'), loader: 'js' };
		});
	},
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const helper = compileHelper(path.join(out, 'mt-pty'));
const helperHash = createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
writeStatic();

const context = await esbuild.context({
	entryPoints: [path.join(root, 'src', 'main.ts')],
	outfile: path.join(out, 'main.js'),
	bundle: true,
	format: 'cjs',
	platform: 'browser',
	target: 'es2022',
	external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
	define: { MT_PTY_SHA256: JSON.stringify(helperHash) },
	banner: { js: `/* ${manifest.name} ${manifest.version}, bundled with xterm.js (MIT). Source: src/ */` },
	logLevel: 'info',
	treeShaking: true,
	minify: false,
	sourcemap: watch ? 'inline' : false,
	legalComments: 'inline',
	plugins: [xtermPlatformFix],
});

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
	console.log(`Built ${path.relative(root, out)} (mt-pty sha256 ${helperHash.slice(0, 12)}…)`);
}
