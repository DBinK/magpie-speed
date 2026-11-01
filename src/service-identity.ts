import { createHash } from 'node:crypto';
import { options, type Options } from './config';

export const VERSION = '0.1.0';

export function serviceIdentity(input: Options = {}) {
  const opt = options(input);
  return {
    app: 'magpie-speed',
    protocol: 1,
    version: VERSION,
    configuration: createHash('sha256')
      .update(JSON.stringify({ gateway: opt.gateway, apiKey: opt.apiKey, demo: opt.demo }))
      .digest('hex'),
  };
}
