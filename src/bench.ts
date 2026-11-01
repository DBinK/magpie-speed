import { sseEvents } from './sse';
import { Gateway } from './gateway';
import { count, list, object, text } from './json';
import { boundedText } from './http';
import type { Model, RunConfig, Sample, Stats, Target } from './types';

export interface MeasureContext {
  gateway: Gateway;
  config: RunConfig;
  target: Target;
  index: number;
  signal: AbortSignal;
  onProgress?: (sample: Sample) => void;
}

const round = (value: number) => Math.round(value * 10) / 10;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

const present = (values: (number | undefined)[]) =>
  values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** Median of successful repeats; failures never contribute a number. */
export function summarize(samples: Sample[]): Stats | null {
  const done = samples.filter((s) => s.state === 'done');
  if (!done.length) return null;
  const ttft = median(present(done.map((s) => s.ttftMs)));
  const firstContent = median(present(done.map((s) => s.firstContentMs)));
  return {
    samples: done.length,
    ttftMs: ttft === null ? null : Math.round(ttft),
    firstContentMs: firstContent === null ? null : Math.round(firstContent),
    reasoningMs: median(present(done.map((s) => s.reasoningMs))),
    totalMs: median(present(done.map((s) => s.totalMs))),
    decodeTps: median(present(done.map((s) => s.decodeTps))),
    wallTps: median(present(done.map((s) => s.wallTps))),
    outputTokens: median(present(done.map((s) => s.outputTokens))),
    reasoningTokens: median(present(done.map((s) => s.reasoningTokens))),
  };
}

/** One streamed completion, timed from request start to the last token. */
export async function measure(ctx: MeasureContext): Promise<Sample> {
  const { gateway, config, target, index, signal } = ctx;
  const sample: Sample = { index, state: 'streaming', outputChars: 0, chunks: 0 };
  const started = performance.now();
  let firstDeltaAt: number | undefined;
  let firstContentAt: number | undefined;
  let lastDeltaAt: number | undefined;
  let reasoningChunks = 0;
  let answerChars = 0;
  let usage: Record<string, unknown> = {};
  let lastProgress = 0;

  const body: Record<string, unknown> = {
    model: target.model,
    messages: [
      ...(config.system ? [{ role: 'system', content: config.system }] : []),
      { role: 'user', content: config.prompt },
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: config.maxTokens,
  };
  if (target.effort) body.reasoning_effort = target.effort;

  const response = await gateway.chat(body, signal);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Gateway returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    const detail = await boundedText(response, 8192).catch(() => '');
    let message = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
    try {
      const error = object(JSON.parse(detail)).error;
      const upstream = text(error) ?? text(object(error).message);
      if (upstream) message = upstream;
    } catch {
      /* An HTML or plain-text error page is reported verbatim. */
    }
    throw new Error(
      `Gateway returned ${contentType || 'a non-stream response'} instead of an event stream${message ? `: ${message}` : '.'}`,
    );
  }

  let finishReason = '';
  let sawDone = false;
  for await (const payload of sseEvents(response)) {
    if (payload === '[DONE]') {
      sawDone = true;
      break;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    const envelope = object(chunk);
    if (envelope.error) throw new Error(text(object(envelope.error).message) || 'Upstream error.');
    if (envelope.usage) usage = object(envelope.usage);
    const choice = object(list(envelope.choices)[0]);
    const reason = text(choice.finish_reason);
    if (reason) finishReason = reason;
    const delta = object(choice.delta);
    const at = performance.now();
    const reasoning = text(delta.reasoning_content) ?? text(delta.reasoning) ?? '';
    const content = text(delta.content) ?? '';
    if (!reasoning && !content) continue;
    firstDeltaAt ??= at;
    lastDeltaAt = at;
    sample.chunks++;
    if (reasoning) {
      reasoningChunks++;
      sample.outputChars += reasoning.length;
    }
    if (content) {
      firstContentAt ??= at;
      answerChars += content.length;
      sample.outputChars += content.length;
    }
    if (ctx.onProgress && at - lastProgress > 200) {
      lastProgress = at;
      sample.ttftMs = Math.round(firstDeltaAt - started);
      if (firstContentAt) sample.firstContentMs = Math.round(firstContentAt - started);
      sample.totalMs = Math.round(at - started);
      sample.outputTokens = sample.chunks;
      sample.estimated = true;
      sample.decodeTps =
        lastDeltaAt > firstDeltaAt
          ? round((sample.chunks * 1000) / (lastDeltaAt - firstDeltaAt))
          : undefined;
      ctx.onProgress(sample);
    }
  }

  // A truncated stream must not be reported as a valid measurement: without a
  // finish reason or the stream's own terminator the generation is incomplete.
  if (!finishReason && !sawDone)
    throw new Error(
      'Upstream stream ended before reporting finish_reason; the measurement is incomplete.',
    );

  const ended = performance.now();
  sample.state = 'done';
  sample.totalMs = Math.round(ended - started);
  if (firstDeltaAt !== undefined) sample.ttftMs = Math.round(firstDeltaAt - started);
  if (firstContentAt !== undefined) {
    sample.firstContentMs = Math.round(firstContentAt - started);
    if (firstDeltaAt !== undefined)
      sample.reasoningMs = Math.max(0, Math.round(firstContentAt - firstDeltaAt));
  }

  const promptTokens = count(usage.prompt_tokens);
  const outputTokens = count(usage.completion_tokens);
  const reasoningTokens = count(object(usage.completion_tokens_details).reasoning_tokens);
  const cachedTokens = count(object(usage.prompt_tokens_details).cached_tokens);
  if (promptTokens !== undefined) sample.promptTokens = promptTokens;
  if (cachedTokens !== undefined) sample.cachedTokens = cachedTokens;
  sample.estimated = outputTokens === undefined;
  sample.outputTokens = outputTokens ?? Math.max(sample.chunks, Math.round(sample.outputChars / 4));
  sample.reasoningTokens =
    reasoningTokens ?? (typeof outputTokens === 'number' ? 0 : reasoningChunks);

  if (firstDeltaAt !== undefined && lastDeltaAt !== undefined && lastDeltaAt > firstDeltaAt)
    sample.decodeTps = round((sample.outputTokens * 1000) / (lastDeltaAt - firstDeltaAt));
  if (ended > started) sample.wallTps = round((sample.outputTokens * 1000) / (ended - started));
  return sample;
}

/** Resolves the catalog entry so validation rejects unknown models up front. */
export function findModel(models: Model[], target: Target): Model | undefined {
  return models.find((m) => m.id === target.model);
}
