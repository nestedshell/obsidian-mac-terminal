// The files of an installed plugin, shared by install.mjs and package.mjs.
// The mt-pty helper is not among them: it travels inside main.js.
export const SHIPPED = ['main.js', 'manifest.json', 'styles.css'];

/** Left over by earlier builds: node-pty, and mt-pty from before it moved into main.js. */
export const OBSOLETE = ['node-pty', 'mt-pty'];
