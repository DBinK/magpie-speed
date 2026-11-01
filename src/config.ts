import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Options {
  port?: number;
  gateway?: string;
  apiKey?: string;
  dataDir?: string;
  demo?: boolean;
  uiDir?: string;
}

export function options(
  input: Options = {},
): Required<Omit<Options, 'uiDir'>> & Pick<Options, 'uiDir'> {
  const addr = process.env.MAGPIE_ADDR?.replace(/^(0\.0\.0\.0|\[::\]):/, '127.0.0.1:');
  const gateway = (
    input.gateway ||
    process.env.MAGPIE_SPEED_GATEWAY ||
    (addr ? `http://${addr}` : 'http://127.0.0.1:3425')
  ).replace(/\/+$/, '');
  const url = new URL(gateway);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error(
      'Gateway must be an HTTP(S) origin without credentials, path, query or fragment.',
    );
  const port = input.port ?? Number(process.env.MAGPIE_SPEED_PORT || 3489);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid service port.');
  return {
    port,
    gateway,
    apiKey: input.apiKey || process.env.MAGPIE_SPEED_API_KEY || '',
    dataDir:
      input.dataDir ||
      process.env.MAGPIE_SPEED_DATA_DIR ||
      join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'magpie', 'speed'),
    demo: input.demo ?? false,
    uiDir: input.uiDir,
  };
}
