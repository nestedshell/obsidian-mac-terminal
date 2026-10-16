// The plugin runs in Obsidian's window; give Node tests the same `window` global.
(globalThis as { window?: unknown }).window ??= globalThis;
