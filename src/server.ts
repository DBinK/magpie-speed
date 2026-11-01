import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { options, type Options } from './config';
import { Gateway } from './gateway';
import { Store, validateConfig } from './store';
import { boundedText, BodyTooLargeError } from './http';
import { measure, summarize } from './bench';
import { measureDemo, demoModels } from './demo';
import { serviceIdentity, VERSION } from './service-identity';
import type { Bootstrap, Model, Run, RunConfig, Sample, TargetResult } from './types';

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, { status, headers });
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const terminal = (run: Run) =>
  run.state === 'completed' || run.state === 'failed' || run.state === 'cancelled';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export interface Service {
  port: number;
  demo: boolean;
  close(): Promise<void>;
}

export async function startServer(input: Options = {}): Promise<Service> {
  const opt = options(input);
  const gateway = new Gateway(opt.gateway, opt.apiKey);
  const store = new Store(join(opt.dataDir, opt.demo ? 'demo-runs' : 'runs'));
  const token = randomBytes(32).toString('hex');
  const active = new Map<string, AbortController>();
  const listeners = new Map<string, Set<(run: Run) => void>>();
  let models: Model[] = [];
  let catalogError = '';
  let creating = false;
  let closed = false;

  const emit = (run: Run) => {
    for (const listener of listeners.get(run.id) ?? []) listener(run);
  };
  const persist = async (run: Run) => {
    emit(run);
    // A run deleted from history mid-flight must not resurrect its file.
    if (store.runs.has(run.id)) await store.save(run);
  };
  const catalog = async () => {
    if (opt.demo) {
      models = demoModels;
      return models;
    }
    try {
      models = await gateway.catalog();
      catalogError = '';
    } catch (error) {
      catalogError = gateway.redact(error);
    }
    return models;
  };

  await store.load();
  const initialized = catalog();

  function newRun(config: RunConfig): Run {
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      state: 'queued',
      config,
      results: config.targets.map((target, i): TargetResult => ({
        id: `target-${i + 1}`,
        target,
        state: 'queued',
        samples: Array.from({ length: config.repeats }, (_, index): Sample => ({
          index,
          state: 'pending',
          outputChars: 0,
          chunks: 0,
        })),
        stats: null,
        error: null,
      })),
      ...(opt.demo ? { demo: true } : {}),
    };
  }

  /** Runs measure strictly one target and one repeat at a time: concurrent
   * streams compete for the same provider quota and distort the numbers. */
  async function execute(run: Run) {
    const controller = new AbortController();
    active.set(run.id, controller);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort(new Error('Run deadline exceeded'));
    }, run.config.deadlineSeconds * 1000);
    try {
      run.state = 'running';
      await persist(run);
      for (const result of run.results) {
        if (controller.signal.aborted) break;
        result.state = 'running';
        await persist(run);
        for (const sample of result.samples) {
          if (controller.signal.aborted) break;
          sample.state = 'streaming';
          emit(run);
          try {
            const measured = opt.demo
              ? await measureDemo({
                  gateway,
                  config: run.config,
                  target: result.target,
                  index: sample.index,
                  signal: controller.signal,
                  onProgress: (live) => {
                    Object.assign(sample, live, { state: 'streaming' as const });
                    emit(run);
                  },
                })
              : await measure({
                  gateway,
                  config: run.config,
                  target: result.target,
                  index: sample.index,
                  signal: controller.signal,
                  onProgress: (live) => {
                    Object.assign(sample, live, { state: 'streaming' as const });
                    emit(run);
                  },
                });
            Object.assign(sample, measured);
          } catch (error) {
            sample.state = controller.signal.aborted ? 'cancelled' : 'failed';
            sample.error = gateway.redact(error);
          }
          emit(run);
          await store.save(run);
        }
        const done = result.samples.filter((s) => s.state === 'done');
        result.stats = summarize(result.samples);
        result.state = controller.signal.aborted
          ? 'cancelled'
          : done.length
            ? 'completed'
            : 'failed';
        result.error = done.length ? null : (result.samples[0]?.error ?? null);
        await persist(run);
      }
    } finally {
      clearTimeout(timer);
      active.delete(run.id);
      for (const result of run.results) {
        for (const sample of result.samples)
          if (sample.state === 'streaming' || sample.state === 'pending')
            sample.state = 'cancelled';
        if (result.state === 'queued' || result.state === 'running') result.state = 'cancelled';
        result.stats = summarize(result.samples);
      }
      const measured = run.results.some((result) => result.stats !== null);
      run.state = controller.signal.aborted ? 'cancelled' : measured ? 'completed' : 'failed';
      run.finishedAt = new Date().toISOString();
      if (expired) run.error = 'Run deadline exceeded.';
      else if (!controller.signal.aborted && !measured)
        run.error = run.results.find((r) => r.error)?.error ?? 'No measurement succeeded.';
      await persist(run);
      await store.prune();
    }
  }

  function stream(run: Run): Response {
    const encoder = new TextEncoder();
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let finished = false;
        const send = (value: Run) => {
          if (finished) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
          if (terminal(value)) close();
        };
        const close = () => {
          if (finished) return;
          finished = true;
          clearInterval(beat);
          set.delete(send);
          if (!set.size) listeners.delete(run.id);
          try {
            controller.close();
          } catch {
            /* The client may already have closed the stream. */
          }
        };
        const beat = setInterval(() => {
          if (!finished) controller.enqueue(encoder.encode(': keepalive\n\n'));
        }, 15000);
        const set = listeners.get(run.id) ?? new Set<(value: Run) => void>();
        set.add(send);
        listeners.set(run.id, set);
        stop = close;
        send(run);
      },
      cancel() {
        stop();
      },
    });
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  }

  const uiDir =
    opt.uiDir ||
    resolve(
      import.meta.dir,
      import.meta.dir.replaceAll('\\', '/').endsWith('/src') ? '../dist/ui' : 'ui',
    );

  let server: Bun.Server<unknown>;
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: opt.port,
    idleTimeout: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const own = `127.0.0.1:${server.port}`;
      const host = req.headers.get('host');
      if (host !== own && host !== `localhost:${server.port}`)
        return new Response('Invalid host', { status: 403 });
      const origin = req.headers.get('origin');
      if (
        origin &&
        origin !== 'null' &&
        origin !== `http://${own}` &&
        origin !== `http://localhost:${server.port}`
      )
        return new Response('Invalid origin', { status: 403 });
      const cors: Record<string, string> = {
        'access-control-allow-origin': origin || '*',
        'access-control-allow-headers': 'Authorization, Content-Type',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        vary: 'Origin',
        'cache-control': 'no-store',
      };
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (url.pathname === '/_speed/health' && req.method === 'GET')
        return json(serviceIdentity(opt), 200, cors);

      await initialized;
      if (url.pathname.startsWith('/api/')) {
        if (!equal(req.headers.get('authorization')?.replace(/^Bearer /, '') || '', token))
          return json({ error: 'Unauthorized' }, 401, cors);
        try {
          const path = url.pathname;
          let response: Response;
          if (path === '/api/bootstrap' && req.method === 'GET') {
            const payload: Bootstrap = {
              version: VERSION,
              demo: opt.demo,
              models,
              runs: store.list(),
              gateway: {
                url: opt.gateway,
                reachable: opt.demo || !catalogError,
                ...(catalogError ? { error: catalogError } : {}),
              },
            };
            response = json(payload);
          } else if (path === '/api/catalog' && req.method === 'POST') {
            response = json({ models: await catalog() });
          } else if (path === '/api/runs' && req.method === 'GET') {
            response = json(store.list());
          } else if (path === '/api/runs' && req.method === 'POST') {
            if (creating || active.size)
              return json({ error: 'A measurement run is already in progress.' }, 409, cors);
            if (!models.length)
              return json(
                { error: catalogError || 'No models available from the Magpie gateway.' },
                503,
                cors,
              );
            if (Number(req.headers.get('content-length') || 0) > 65536)
              return json({ error: 'Request too large' }, 413, cors);
            creating = true;
            try {
              const payload: unknown = JSON.parse(await boundedText(req.body, 65536));
              const config = validateConfig(payload, models);
              const run = newRun(config);
              store.runs.set(run.id, run);
              await store.save(run);
              void execute(run).catch((error) => {
                run.state = 'failed';
                run.error = `Could not save run history: ${gateway.redact(error)}`;
                emit(run);
              });
              response = json(run, 202);
            } finally {
              creating = false;
            }
          } else {
            const match = path.match(/^\/api\/runs\/([\w-]+)(\/events|\/cancel)?$/);
            const run = match ? store.runs.get(match[1]) : undefined;
            if (!match || !run) return json({ error: 'Run not found' }, 404, cors);
            if (!match[2] && req.method === 'GET') response = json(run);
            else if (!match[2] && req.method === 'DELETE') {
              if (active.has(run.id))
                return json({ error: 'Cancel the run before deleting it.' }, 409, cors);
              await store.remove(run.id);
              response = new Response(null, { status: 204 });
            } else if (match[2] === '/cancel' && req.method === 'POST') {
              active.get(run.id)?.abort(new Error('Cancelled by user.'));
              response = json({ ok: true });
            } else if (match[2] === '/events' && req.method === 'GET') response = stream(run);
            else return json({ error: 'Method not allowed' }, 405, cors);
          }
          for (const [key, value] of Object.entries(cors))
            if (!response.headers.has(key)) response.headers.set(key, value);
          return response;
        } catch (error) {
          const status = error instanceof BodyTooLargeError ? 413 : 400;
          return json({ error: gateway.redact(error) }, status, cors);
        }
      }

      if (req.method !== 'GET' && req.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405 });
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const uiOrigin = url.searchParams.get('uiOrigin');
        if (uiOrigin) {
          const parsed = new URL(uiOrigin);
          if (
            !['http:', 'https:'].includes(parsed.protocol) ||
            parsed.hostname.includes('*') ||
            parsed.origin !== uiOrigin
          )
            throw new Error('Invalid UI origin.');
        }
        // A sandboxed frame has an opaque origin, where CSP 'self' matches
        // nothing: the document's own origin must be named explicitly for its
        // scripts, styles and API calls to load.
        const connectSources: string[] = [
          ...new Set([`http://${host}`, ...(uiOrigin ? [uiOrigin] : [])]),
        ];
        const sources = connectSources.join(' ');
        let html = await readFile(join(uiDir, 'index.html'), 'utf8').catch(
          () =>
            '<!doctype html><title>Build required</title><p>Run bun run build to create the Speed interface.</p>',
        );
        const boot = JSON.stringify({
          token,
          initialProvider: url.searchParams.get('provider') || '',
          theme: url.searchParams.get('theme') || '',
          lang: url.searchParams.get('lang') || '',
        }).replaceAll('<', '\\u003c');
        const nonce = randomBytes(16).toString('base64');
        html = html.replace(
          '</head>',
          `<script nonce="${nonce}">window.__SPEED__=${boot}</script></head>`,
        );
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff',
            // Opaque sandbox origins cannot reliably match 'self'. The launcher
            // supplies Magpie's proxy origin; it affects this document only.
            // No frame-ancestors: Magpie embeds the page from another origin
            // (127.0.0.1:<page port>, a proxy, or wails://localhost), and the
            // API still requires the per-page bearer token plus host/origin checks.
            'content-security-policy': `default-src 'self' ${sources}; connect-src 'self' ${sources}; script-src 'self' ${sources} 'nonce-${nonce}'; style-src 'self' ${sources} 'unsafe-inline'; img-src 'self' ${sources} data:; font-src 'self' ${sources} data:; object-src 'none'; base-uri 'none'; form-action 'none'`,
          },
        });
      }

      const relative = decodeURIComponent(url.pathname.slice(1));
      const file = resolve(uiDir, relative);
      if (!file.startsWith(uiDir + sep)) return new Response('Not found', { status: 404 });
      if (!(await Bun.file(file).exists())) return new Response('Not found', { status: 404 });
      return new Response(Bun.file(file), {
        headers: {
          'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          // Vite marks its module scripts and stylesheets crossorigin. In a
          // sandboxed frame the document origin is opaque, so those requests
          // carry Origin: null and need an explicit CORS allowance.
          ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
        },
      });
    },
  });

  return {
    port: server.port!,
    demo: opt.demo,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of active.values()) controller.abort(new Error('Service stopped.'));
      for (const set of listeners.values()) set.clear();
      listeners.clear();
      await store.flush();
      server.stop(true);
    },
  };
}
