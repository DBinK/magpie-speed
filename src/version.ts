import pkg from '../package.json' with { type: 'json' };

/** package.json's `version` is the only place a version is written. */
export const VERSION: string = pkg.version;
