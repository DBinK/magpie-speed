// The plugin's host part, found by magpie's host at the package root
// (host.js's index files) rather than through package.json's main: a
// package with neither main nor exports is what magpie labels a page.
export { default } from './dist/plugin.js';
