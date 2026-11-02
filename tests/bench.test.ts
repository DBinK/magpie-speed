import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Gateway } from '../src/gateway';
import { measure, summarize } from '../src/bench';
import { EFFORT_OFF } from '../src/types';
import type { RunConfig, Sample } from '../src/types';

let server: ReturnType<typeof Bun.serve>;
let gateway: Gateway;
let withUsage = true;
let sentEfforts: (string | undefined)[] = [];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models')
        return Response.json({
          data: [
            {
              id: 'acme/fast',
              display_name: 'Fast',
              reasoning_levels: ['low', 'high'],
              native_endpoints: ['/v1/chat/completions'],
            },
            { id: 'acme/embed', type: 'embedding', native_endpoints: [] },
          ],
        });
      if (url.pathname !== '/v1/chat/completions') return new Response('no', { status: 404 });
      const body = (await req.json()) as { model: string; reasoning_effort?: string };
      sentEfforts.push(body.reasoning_effort);
      // Failure shapes the page must never record as a valid measurement.
      if (body.model === 'acme/errorpage')
        return Response.json({ error: { message: 'upstream exploded' } }, { status: 200 });
      if (body.model === 'acme/htmlpage')
        return new Response('<html>bad gateway</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      const truncated = body.model === 'acme/truncated';
      const noDone = body.model === 'acme/nodone';
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (value: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
          await delay(30);
          send({ choices: [{ delta: { reasoning_content: 'think' } }] });
          await delay(30);
          for (let i = 0; i < 4; i++) {
            await delay(20);
            send({
              choices: [
                {
                  delta: { content: `tok${i} ` },
                  finish_reason: i === 3 && !truncated ? 'stop' : null,
                },
              ],
            });
          }
          if (truncated) {
            controller.close();
            return;
          }
          if (withUsage)
            send({
              choices: [],
              usage: {
                prompt_tokens: 12,
                completion_tokens: 9,
                completion_tokens_details: { reasoning_tokens: 4 },
              },
            });
          if (!noDone) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  gateway = new Gateway(`http://127.0.0.1:${server.port}`);
});

afterAll(() => server.stop(true));

const config: RunConfig = {
  targets: [{ model: 'acme/fast', effort: 'high' }],
  prompt: 'hello',
  system: '',
  maxTokens: 256,
  repeats: 1,
  deadlineSeconds: 30,
};

test('catalog keeps text models and their reasoning levels', async () => {
  const models = await gateway.catalog();
  expect(models).toEqual([
    {
      id: 'acme/fast',
      name: 'Fast',
      provider: 'acme',
      efforts: ['low', 'high'],
    },
  ]);
});

test('measures first token, answer start and usage tokens', async () => {
  const sample = await measure({
    gateway,
    config,
    target: { model: 'acme/fast', effort: 'high' },
    index: 0,
    signal: new AbortController().signal,
  });
  expect(sample.state).toBe('done');
  expect(sample.ttftMs!).toBeGreaterThanOrEqual(25);
  expect(sample.firstContentMs!).toBeGreaterThan(sample.ttftMs!);
  expect(sample.reasoningMs).toBeGreaterThanOrEqual(25);
  expect(sample.outputTokens).toBe(9);
  expect(sample.reasoningTokens).toBe(4);
  expect(sample.promptTokens).toBe(12);
  expect(sample.estimated).toBe(false);
  expect(sample.decodeTps!).toBeGreaterThan(0);
  expect(sample.wallTps!).toBeGreaterThan(0);
});

test('asks for reasoning off where the target says none', async () => {
  sentEfforts = [];
  await measure({
    gateway,
    config,
    target: { model: 'acme/fast', effort: EFFORT_OFF },
    index: 0,
    signal: new AbortController().signal,
  });
  expect(sentEfforts).toEqual([EFFORT_OFF]);
});

test('falls back to streamed chunk counts when usage is absent', async () => {
  withUsage = false;
  try {
    const sample = await measure({
      gateway,
      config,
      target: { model: 'acme/fast', effort: '' },
      index: 0,
      signal: new AbortController().signal,
    });
    expect(sample.estimated).toBe(true);
    expect(sample.outputTokens).toBeGreaterThanOrEqual(5);
    expect(sample.outputChars).toBeGreaterThan(0);
  } finally {
    withUsage = true;
  }
});

test('summarizes the median of successful repeats only', () => {
  const base: Omit<Sample, 'index' | 'state' | 'outputChars' | 'chunks' | 'decodeTps'> = {
    ttftMs: 100,
    totalMs: 1000,
  };
  const samples: Sample[] = [
    { ...base, index: 0, state: 'done', outputChars: 1, chunks: 1, decodeTps: 10 },
    { ...base, index: 1, state: 'done', outputChars: 1, chunks: 1, ttftMs: 200, decodeTps: 20 },
    { ...base, index: 2, state: 'done', outputChars: 1, chunks: 1, ttftMs: 300, decodeTps: 30 },
    { index: 3, state: 'failed', outputChars: 0, chunks: 0 },
  ];
  const stats = summarize(samples)!;
  expect(stats.samples).toBe(3);
  expect(stats.ttftMs).toBe(200);
  expect(stats.decodeTps).toBe(20);
});

test('rejects a truncated stream instead of recording it', async () => {
  await expect(
    measure({
      gateway,
      config,
      target: { model: 'acme/truncated', effort: '' },
      index: 0,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/finish_reason/);
});

test('accepts finish_reason without the [DONE] sentinel', async () => {
  const sample = await measure({
    gateway,
    config,
    target: { model: 'acme/nodone', effort: '' },
    index: 0,
    signal: new AbortController().signal,
  });
  expect(sample.state).toBe('done');
  expect(sample.outputTokens).toBe(9);
});

test('rejects a 200 JSON error page', async () => {
  await expect(
    measure({
      gateway,
      config,
      target: { model: 'acme/errorpage', effort: '' },
      index: 0,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/upstream exploded/);
});

test('rejects a 200 HTML page that is not an event stream', async () => {
  await expect(
    measure({
      gateway,
      config,
      target: { model: 'acme/htmlpage', effort: '' },
      index: 0,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/instead of an event stream/);
});
