import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type Service } from '../src/server';

let upstream: ReturnType<typeof Bun.serve>;
let service: Service;
let base: string;
let token: string;
let dir: string;

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/api/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

beforeAll(async () => {
  upstream = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models')
        return Response.json({
          data: [
            {
              id: 'acme/broken',
              display_name: 'Broken',
              native_endpoints: ['/v1/chat/completions'],
            },
            {
              id: 'acme/errorpage',
              display_name: 'Error page',
              native_endpoints: ['/v1/chat/completions'],
            },
          ],
        });
      const body = (await req.json()) as { model: string };
      if (body.model === 'acme/errorpage')
        return Response.json({ error: { message: 'upstream exploded' } }, { status: 200 });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    },
  });

  dir = await mkdtemp(join(tmpdir(), 'magpie-speed-fail-'));
  await mkdir(join(dir, 'ui'));
  await writeFile(join(dir, 'ui/index.html'), '<!doctype html><head></head><body>Test</body>');
  service = await startServer({
    port: 0,
    dataDir: dir,
    uiDir: join(dir, 'ui'),
    gateway: `http://127.0.0.1:${upstream.port}`,
  });
  base = `http://127.0.0.1:${service.port}`;
  const html = await (await fetch(base)).text();
  token = JSON.parse(html.match(/window\.__SPEED__=(.*?)<\/script>/)![1]).token;
});

afterAll(async () => {
  await service?.close();
  upstream?.stop(true);
  await rm(dir, { recursive: true, force: true });
});

test('marks truncated and error-page responses as failed measurements', async () => {
  const created = await api('runs', {
    method: 'POST',
    body: JSON.stringify({
      targets: [
        { model: 'acme/broken', effort: '' },
        { model: 'acme/errorpage', effort: '' },
      ],
      prompt: 'fail please',
      system: '',
      maxTokens: 256,
      repeats: 1,
      deadlineSeconds: 30,
    }),
  });
  expect(created.status).toBe(202);
  const run = await created.json();
  let current = run;
  for (let attempt = 0; attempt < 100; attempt++) {
    current = await api(`runs/${run.id}`).then((res) => res.json());
    if (['completed', 'failed', 'cancelled'].includes(current.state)) break;
    await Bun.sleep(50);
  }
  expect(current.state).toBe('failed');
  expect(current.results[0].samples[0].state).toBe('failed');
  expect(current.results[0].samples[0].error).toContain('finish_reason');
  expect(current.results[1].samples[0].state).toBe('failed');
  expect(current.results[1].samples[0].error).toContain('upstream exploded');
  expect(current.results[0].stats).toBeNull();
  expect(current.results[1].stats).toBeNull();
  expect(current.error).toContain('finish_reason');
});
