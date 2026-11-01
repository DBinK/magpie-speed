import { options, type Options } from './config';
import { boundedText } from './http';
import { object, text } from './json';
import { startServer, type Service } from './server';
import { serviceIdentity } from './service-identity';

export interface ManagedService {
  readonly error: string;
  close(): Promise<void>;
}

/** Hosts with identical settings share one listener. An attached host takes over
 * when its owner exits; no detached daemon survives the Magpie hosts. */
export async function startManagedService(
  input: Options = {},
  pollMs = 1000,
): Promise<ManagedService> {
  const opt = options(input);
  const identity = serviceIdentity(opt);
  let owned: Service | undefined;
  let closed = false;
  let checking: Promise<void> | undefined;
  let lastError = '';
  const probe = async () => {
    if (!opt.port) return false;
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${opt.port}/_speed/health`, {
        signal: AbortSignal.timeout(1000),
        redirect: 'error',
      });
    } catch {
      return false;
    }
    try {
      const peer = object(JSON.parse(await boundedText(response, 4096)));
      if (
        response.ok &&
        peer.app === identity.app &&
        peer.protocol === identity.protocol &&
        peer.configuration === identity.configuration
      )
        return true;
    } catch {
      /* An occupied port is never assumed to be our service. */
    }
    throw new Error(
      `Port ${opt.port} belongs to an incompatible Speed service or another application. Use another port.`,
    );
  };
  const acquire = async () => {
    if (closed || owned || (await probe())) return;
    try {
      owned = await startServer(opt);
    } catch (error) {
      // Another host may have won between discovery and bind.
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && (await probe())) return;
      throw error;
    }
    if (closed) {
      await owned.close();
      owned = undefined;
    }
  };
  const reconcile = () =>
    (checking ??= acquire()
      .catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : text(error) || 'Unknown error';
        throw error;
      })
      .finally(() => {
        checking = undefined;
      }));
  await reconcile();
  const timer = setInterval(() => {
    reconcile().catch(() => undefined);
  }, pollMs);
  return {
    get error() {
      return lastError;
    },
    async close() {
      closed = true;
      clearInterval(timer);
      await owned?.close();
      owned = undefined;
    },
  };
}
