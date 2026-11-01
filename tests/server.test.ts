import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type Service } from '../src/server';

let dir: string;
let base: string;
let token: string;
let service: Service;

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/api/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'magpie-speed-test-'));
  await mkdir(join(dir, 'ui'));
  await writeFile(join(dir, 'ui/index.html'), '<!doctype html><head></head><body>Test</body>');
  await mkdir(join(dir, 'ui/assets'));
  await writeFile(join(dir, 'ui/assets/app.js'), 'console.log("asset")');
  service = await startServer({ port: 0, dataDir: dir, uiDir: join(dir, 'ui'), demo: true });
  base = `http://127.0.0.1:${service.port}`;
  const html = await (await fetch(base)).text();
  token = JSON.parse(html.match(/window\.__SPEED__=(.*?)<\/script>/)![1]).token;
});

afterAll(async () => {
  await service?.close();
  await rm(dir, { recursive: true, force: true });
});

test('guards the API with a page token, host and origin', async () => {
  expect((await fetch(`${base}/api/bootstrap`)).status).toBe(401);
  expect((await fetch(base, { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
  expect((await fetch(base, { headers: { host: 'attacker.example' } })).status).toBe(403);
  expect((await api('bootstrap', { headers: { origin: 'null' } })).status).toBe(200);
});

test('exposes the demo catalog and health identity', async () => {
  const health = await fetch(`${base}/_speed/health`).then((res) => res.json());
  expect(health.app).toBe('magpie-speed');
  const boot = await api('bootstrap').then((res) => res.json());
  expect(boot.demo).toBe(true);
  expect(boot.models.length).toBeGreaterThan(0);
  expect(boot.models[0].efforts.length).toBeGreaterThan(0);
});

test('rejects invalid runs before starting work', async () => {
  const missing = await api('runs', {
    method: 'POST',
    body: JSON.stringify({
      targets: [],
      prompt: 'x',
      maxTokens: 256,
      repeats: 1,
      deadlineSeconds: 30,
    }),
  });
  expect(missing.status).toBe(400);
  const unknown = await api('runs', {
    method: 'POST',
    body: JSON.stringify({
      targets: [{ model: 'nope/none', effort: '' }],
      prompt: 'x',
      maxTokens: 256,
      repeats: 1,
      deadlineSeconds: 30,
    }),
  });
  expect(unknown.status).toBe(400);
});

test('runs a measurement to completion and persists its history', async () => {
  const created = await api('runs', {
    method: 'POST',
    body: JSON.stringify({
      targets: [{ model: 'deepseek/deepseek-v4', effort: 'high' }],
      prompt: '请给出一个简短的测速说明。',
      system: '',
      maxTokens: 256,
      repeats: 1,
      deadlineSeconds: 30,
    }),
  });
  expect(created.status).toBe(202);
  const run = await created.json();
  expect(['queued', 'running']).toContain(run.state);

  let current = run;
  for (let attempt = 0; attempt < 100; attempt++) {
    const res = await api(`runs/${run.id}`);
    current = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(current.state)) break;
    await Bun.sleep(50);
  }
  expect(current.state).toBe('completed');
  const result = current.results[0];
  expect(result.stats).not.toBeNull();
  expect(result.stats.ttftMs).toBeGreaterThan(0);
  expect(result.stats.decodeTps).toBeGreaterThan(0);
  expect(result.samples[0].state).toBe('done');

  const history = await api('runs').then((res) => res.json());
  expect(history.some((item: { id: string }) => item.id === run.id)).toBe(true);

  expect((await api(`runs/${run.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await api(`runs/${run.id}`)).status).toBe(404);
});

test('streams live run updates over SSE', async () => {
  const created = await api('runs', {
    method: 'POST',
    body: JSON.stringify({
      targets: [{ model: 'openai/gpt-5.1', effort: '' }],
      prompt: '测试 SSE。',
      system: '',
      maxTokens: 128,
      repeats: 1,
      deadlineSeconds: 30,
    }),
  });
  expect(created.status).toBe(202);
  const run = await created.json();
  const events = await api(`runs/${run.id}/events`);
  expect(events.status).toBe(200);
  expect(events.headers.get('content-type')).toContain('text/event-stream');
  const reader = events.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const states: string[] = [];
  while (states.at(-1) !== 'completed' && states.length < 200) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf('\n\n');
    while (at >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const payload = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (payload) states.push(JSON.parse(payload).state);
      at = buffer.indexOf('\n\n');
    }
  }
  expect(states).toContain('running');
  expect(states.at(-1)).toBe('completed');
});

test('cancels an active run and keeps its samples marked cancelled', async () => {
  const created = await api('runs', {
    method: 'POST',
    body: JSON.stringify({
      targets: [{ model: 'google/gemini-3-pro', effort: 'low' }],
      prompt: '取消测试。',
      system: '',
      maxTokens: 256,
      repeats: 5,
      deadlineSeconds: 30,
    }),
  });
  expect(created.status).toBe(202);
  const run = await created.json();
  expect((await api(`runs/${run.id}/cancel`, { method: 'POST' })).status).toBe(200);
  let current = run;
  for (let attempt = 0; attempt < 100; attempt++) {
    current = await api(`runs/${run.id}`).then((res) => res.json());
    if (['completed', 'failed', 'cancelled'].includes(current.state)) break;
    await Bun.sleep(50);
  }
  expect(current.state).toBe('cancelled');
  expect(current.error).toBeUndefined();
  expect(
    current.results[0].samples.every((sample: { state: string }) => sample.state === 'cancelled'),
  ).toBe(true);
});

test('serves module assets to an opaque sandbox origin', async () => {
  const asset = await fetch(`${base}/assets/app.js`, { headers: { origin: 'null' } });
  expect(asset.status).toBe(200);
  expect(asset.headers.get('access-control-allow-origin')).toBe('null');
});

test('policy names its own origin and does not restrict framing', async () => {
  const page = await fetch(base);
  const csp = page.headers.get('content-security-policy') ?? '';
  expect(csp).toContain(`http://127.0.0.1:${service.port}`);
  expect(csp).not.toContain('frame-ancestors');
});
