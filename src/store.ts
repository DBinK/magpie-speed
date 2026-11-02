import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { count, list, object, text } from './json';
import { EFFORT_OFF } from './types';
import type { Run, RunConfig, Sample, Stats, Target, TargetResult } from './types';

const LIMIT = 100;

const RUN_STATES: Record<string, true> = {
  queued: true,
  running: true,
  completed: true,
  failed: true,
  cancelled: true,
  interrupted: true,
};
const SAMPLE_STATES: Record<string, true> = {
  pending: true,
  streaming: true,
  done: true,
  failed: true,
  cancelled: true,
};
const RESULT_STATES: Record<string, true> = {
  queued: true,
  running: true,
  completed: true,
  failed: true,
  cancelled: true,
};

function parseTarget(value: unknown): Target | undefined {
  const row = object(value);
  const model = text(row.model);
  return model ? { model, effort: text(row.effort) ?? '' } : undefined;
}

function parseConfig(value: unknown): RunConfig | undefined {
  const cfg = object(value);
  const targets = list(cfg.targets)
    .map(parseTarget)
    .filter((target): target is Target => !!target);
  const prompt = text(cfg.prompt);
  const maxTokens = count(cfg.maxTokens);
  const repeats = count(cfg.repeats);
  const deadlineSeconds = count(cfg.deadlineSeconds);
  if (!targets.length || prompt === undefined || !maxTokens || !repeats || !deadlineSeconds)
    return undefined;
  return {
    targets,
    prompt,
    system: text(cfg.system) ?? '',
    maxTokens,
    repeats,
    deadlineSeconds,
  };
}

function parseSample(value: unknown): Sample | undefined {
  const row = object(value);
  const index = count(row.index);
  const state = text(row.state);
  if (index === undefined || !state || !SAMPLE_STATES[state]) return undefined;
  const sample: Sample = {
    index,
    state: state as Sample['state'],
    outputChars: count(row.outputChars) ?? 0,
    chunks: count(row.chunks) ?? 0,
  };
  const numeric = [
    'ttftMs',
    'firstContentMs',
    'reasoningMs',
    'totalMs',
    'promptTokens',
    'outputTokens',
    'reasoningTokens',
    'cachedTokens',
    'decodeTps',
    'wallTps',
  ] as const;
  for (const key of numeric) {
    const value = count(row[key]);
    if (value !== undefined) sample[key] = value;
  }
  sample.estimated = row.estimated === true;
  const error = text(row.error);
  if (error) sample.error = error;
  return sample;
}

function parseStats(value: unknown): Stats | null {
  if (!value || typeof value !== 'object') return null;
  const row = object(value);
  const samples = count(row.samples) ?? 0;
  if (!samples) return null;
  const metric = (key: keyof Stats) => {
    const value = count(row[key]);
    return value === undefined ? null : value;
  };
  return {
    samples,
    ttftMs: metric('ttftMs'),
    firstContentMs: metric('firstContentMs'),
    reasoningMs: metric('reasoningMs'),
    totalMs: metric('totalMs'),
    decodeTps: metric('decodeTps'),
    wallTps: metric('wallTps'),
    outputTokens: metric('outputTokens'),
    reasoningTokens: metric('reasoningTokens'),
  };
}

function parseResult(value: unknown): TargetResult | undefined {
  const row = object(value);
  const id = text(row.id);
  const target = parseTarget(row.target);
  const state = text(row.state);
  if (!id || !target || !state || !RESULT_STATES[state]) return undefined;
  return {
    id,
    target,
    state: state as TargetResult['state'],
    samples: list(row.samples)
      .map(parseSample)
      .filter((sample): sample is Sample => !!sample),
    stats: parseStats(row.stats),
    error: text(row.error) ?? null,
  };
}

function parseRun(value: unknown, name: string): Run | undefined {
  const row = object(value);
  const id = text(row.id);
  const createdAt = text(row.createdAt);
  const state = text(row.state);
  const config = parseConfig(row.config);
  if (!id || id !== name.replace(/\.json$/, '') || !createdAt || !state || !config)
    return undefined;
  if (!RUN_STATES[state]) return undefined;
  const results = list(row.results)
    .map(parseResult)
    .filter((result): result is TargetResult => !!result);
  const run: Run = { id, createdAt, state: state as Run['state'], config, results };
  const finishedAt = text(row.finishedAt);
  const error = text(row.error);
  if (finishedAt) run.finishedAt = finishedAt;
  if (error) run.error = error;
  if (row.demo === true) run.demo = true;
  return run;
}

export class Store {
  readonly runs = new Map<string, Run>();
  private writing = Promise.resolve();
  constructor(readonly dir: string) {}

  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) {
      if (!/^[\w-]+\.json$/.test(name)) continue;
      try {
        const run = parseRun(JSON.parse(await readFile(join(this.dir, name), 'utf8')), name);
        if (!run) continue;
        if (run.state === 'running' || run.state === 'queued') {
          run.state = 'interrupted';
          run.error = 'The service restarted before this run finished.';
          run.finishedAt = new Date().toISOString();
          for (const r of run.results)
            if (r.state === 'running' || r.state === 'queued') r.state = 'cancelled';
          await this.save(run);
        }
        this.runs.set(run.id, run);
      } catch {
        /* Damaged files stay on disk; they are never replaced with invented data. */
      }
    }
  }

  list() {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  save(run: Run) {
    const contents = JSON.stringify(run);
    const path = join(this.dir, `${run.id}.json`);
    const next = this.writing.then(async () => {
      const temp = `${path}.tmp`;
      await writeFile(temp, contents, { mode: 0o600 });
      await rename(temp, path);
    });
    this.writing = next.catch(() => {});
    return next;
  }

  async remove(id: string) {
    await this.writing;
    await unlink(join(this.dir, `${id}.json`));
    this.runs.delete(id);
  }

  /** Oldest runs fall away so measurement history cannot grow without bound. */
  async prune() {
    const extra = this.list().slice(LIMIT);
    for (const run of extra) await this.remove(run.id).catch(() => {});
  }

  async flush() {
    await this.writing;
  }
}

/** Accepts whatever the page posted and rejects anything the service cannot run. */
export function validateConfig(
  input: unknown,
  models: { id: string; efforts: string[] }[],
): RunConfig {
  const cfg = object(input);
  const prompt = text(cfg.prompt)?.trim() ?? '';
  const system = text(cfg.system)?.trim() ?? '';
  if (!prompt) throw new Error('Prompt is required.');
  if (prompt.length > 20000) throw new Error('Prompt is limited to 20,000 characters.');
  if (system.length > 8000) throw new Error('System prompt is limited to 8,000 characters.');
  const maxTokens = cfg.maxTokens ?? 2048;
  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 16 ||
    maxTokens > 32768
  )
    throw new Error('maxTokens must be an integer between 16 and 32768.');
  const repeats = cfg.repeats ?? 3;
  if (typeof repeats !== 'number' || ![1, 3, 5].includes(repeats))
    throw new Error('repeats must be 1, 3 or 5.');
  const deadlineSeconds = cfg.deadlineSeconds ?? 120;
  if (
    typeof deadlineSeconds !== 'number' ||
    !Number.isInteger(deadlineSeconds) ||
    deadlineSeconds < 10 ||
    deadlineSeconds > 600
  )
    throw new Error('deadlineSeconds must be an integer between 10 and 600.');
  const targets = list(cfg.targets);
  if (!targets.length) throw new Error('Select at least one model.');
  if (targets.length > 8) throw new Error('At most 8 models per run.');
  const seen = new Set<string>();
  const parsed = targets.map((value) => {
    const row = object(value);
    const model = text(row.model) ?? '';
    const effort = text(row.effort) ?? '';
    const match = models.find((m) => m.id === model);
    if (!match) throw new Error(`Unknown model: ${model || '(empty)'}`);
    // "none" is the off switch rather than a catalogued level, so any model takes it.
    if (effort && effort !== EFFORT_OFF && !match.efforts.includes(effort))
      throw new Error(`${model} does not offer reasoning effort "${effort}".`);
    const key = `${model}|${effort}`;
    if (seen.has(key)) throw new Error(`${model} was selected twice with the same effort.`);
    seen.add(key);
    return { model, effort };
  });
  return { targets: parsed, prompt, system, maxTokens, repeats, deadlineSeconds };
}
