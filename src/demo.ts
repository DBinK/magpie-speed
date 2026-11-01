import type { Model, Sample } from './types';
import type { MeasureContext } from './bench';

export const demoModels: Model[] = [
  {
    id: 'deepseek/deepseek-v4',
    name: 'DeepSeek V4',
    provider: 'deepseek',
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'openai/gpt-5.1',
    name: 'GPT-5.1',
    provider: 'openai',
    efforts: ['minimal', 'low', 'medium', 'high'],
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'google/gemini-3-pro',
    name: 'Gemini 3 Pro',
    provider: 'google',
    efforts: ['low', 'high'],
  },
];

const sleep = (ms: number, signal: AbortSignal) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal.aborted) {
    reject(signal.reason ?? new Error('Cancelled'));
    return promise;
  }
  const stop = () => {
    clearTimeout(timer);
    reject(signal.reason ?? new Error('Cancelled'));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', stop);
    resolve();
  }, ms);
  signal.addEventListener('abort', stop, { once: true });
  return promise;
};

function seedOf(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return Math.abs(hash);
}

/** Illustrative timings for the standalone preview; never used against a gateway. */
export async function measureDemo(ctx: MeasureContext): Promise<Sample> {
  const { target, index, signal } = ctx;
  const seed = seedOf(`${target.model}|${target.effort}|${index}`);
  const ttftMs = 180 + (seed % 620);
  const tokens = 260 + (seed % 420);
  const tps = 28 + (seed % 72);
  const thinking = target.effort === 'high' || target.effort === 'medium';
  const reasoningTokens = thinking ? Math.round(tokens * 0.45) : 0;
  const answerTokens = tokens - reasoningTokens;
  const sample: Sample = { index, state: 'streaming', outputChars: 0, chunks: 0 };

  await sleep(ttftMs, signal);
  sample.ttftMs = ttftMs;
  if (thinking) {
    sample.firstContentMs = ttftMs + Math.round((reasoningTokens / tps) * 1000);
    sample.reasoningMs = sample.firstContentMs - ttftMs;
  } else sample.firstContentMs = ttftMs;

  const steps = 8;
  for (let step = 1; step <= steps; step++) {
    await sleep(250, signal);
    sample.chunks = Math.round((tokens * step) / steps);
    sample.outputChars = sample.chunks * 4;
    sample.outputTokens = sample.chunks;
    sample.totalMs = Math.round(
      (sample.firstContentMs ?? ttftMs) + ((tokens * step) / steps / tps) * 1000,
    );
    sample.decodeTps = tps;
    sample.wallTps = Math.round(((sample.chunks * 1000) / sample.totalMs) * 10) / 10;
    ctx.onProgress?.(sample);
  }

  sample.state = 'done';
  sample.outputTokens = tokens;
  sample.reasoningTokens = reasoningTokens;
  sample.promptTokens = 120;
  sample.outputChars = tokens * 4;
  sample.totalMs = Math.round((sample.firstContentMs ?? ttftMs) + (answerTokens / tps) * 1000);
  sample.decodeTps = tps;
  sample.wallTps = Math.round(((tokens * 1000) / sample.totalMs) * 10) / 10;
  return sample;
}
