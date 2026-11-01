export type MagpieTheme = {
  dark: boolean;
  lang: string;
  tokens: Record<string, string>;
};

type ThemeListener = (theme: MagpieTheme) => void;
type MagpieBridge = {
  theme?: unknown;
  ready?: Promise<unknown>;
  onTheme?: (listener: (theme: unknown) => void) => void;
};

declare global {
  interface Window {
    magpie?: MagpieBridge;
  }
}

/** True only when the page is hosted in Magpie's iframe. */
export const embedded = typeof window !== 'undefined' && window.parent !== window;

/** Keep host data at the narrow boundary used by the page. */
export function normalizeTheme(value: unknown): MagpieTheme | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { dark?: unknown; lang?: unknown; tokens?: unknown };
  if (typeof candidate.dark !== 'boolean') return null;
  const tokens: Record<string, string> = {};
  if (candidate.tokens && typeof candidate.tokens === 'object') {
    for (const [key, token] of Object.entries(candidate.tokens)) {
      if (typeof token === 'string') tokens[key] = token;
    }
  }
  return {
    dark: candidate.dark,
    lang: typeof candidate.lang === 'string' && candidate.lang ? candidate.lang : 'en',
    tokens,
  };
}

const listeners = new Set<ThemeListener>();
let bridgeWired = false;
let bridgeWiring = false;
let latestTheme: MagpieTheme | null = null;
const bridgeLoaded =
  typeof window !== 'undefined' && typeof document !== 'undefined'
    ? import('./vendor/magpie-bridge.js').catch(() => undefined)
    : Promise.resolve(undefined);

function bridge(): MagpieBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.magpie;
}

function publish(value: unknown) {
  const theme = normalizeTheme(value);
  if (!theme) return;
  latestTheme = theme;
  // The CSS bridge owns the token values; this marker lets the page opt into
  // aliases only after a real host theme has arrived.
  document.documentElement.dataset.magpie = 'connected';
  for (const listener of listeners) {
    try {
      listener(theme);
    } catch {
      // A page listener must not break delivery to the other listeners.
    }
  }
}

function wireBridge() {
  if (bridgeWired || bridgeWiring || !embedded) return;
  bridgeWiring = true;
  void bridgeLoaded.then(() => {
    const api = bridge();
    if (!api) return;
    bridgeWired = true;
    api.onTheme?.(publish);
    // `ready` is intentionally observed without awaiting it here: standalone
    // pages may never receive a parent hello response.
    api.ready?.then(publish, () => undefined);
    if (api.theme) publish(api.theme);
  });
}

/** Subscribe to host theme changes. Returns a cleanup function. */
export function subscribeTheme(listener: ThemeListener): () => void {
  if (!embedded) return () => undefined;
  listeners.add(listener);
  if (latestTheme) listener(latestTheme);
  wireBridge();
  return () => listeners.delete(listener);
}
