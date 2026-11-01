export interface Model {
  id: string;
  name: string;
  provider: string;
  efforts: string[];
}

/** One model at one reasoning effort. An empty effort means "provider default". */
export interface Target {
  model: string;
  effort: string;
}

export interface RunConfig {
  targets: Target[];
  prompt: string;
  system: string;
  maxTokens: number;
  repeats: number;
  deadlineSeconds: number;
}

export interface Sample {
  index: number;
  state: 'pending' | 'streaming' | 'done' | 'failed' | 'cancelled';
  /** Request start to the first streamed token (reasoning included). */
  ttftMs?: number;
  /** Request start to the first answer token; thinking models emit reasoning first. */
  firstContentMs?: number;
  /** Duration of the reasoning phase before the answer begins. */
  reasoningMs?: number;
  totalMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  outputChars: number;
  chunks: number;
  /** Output tokens per second across the whole generation (first to last token). */
  decodeTps?: number;
  /** Output tokens per second across the whole request, including TTFT. */
  wallTps?: number;
  /** Token counts were inferred locally because the provider sent no usage. */
  estimated?: boolean;
  error?: string;
}

export interface Stats {
  samples: number;
  ttftMs: number | null;
  firstContentMs: number | null;
  reasoningMs: number | null;
  totalMs: number | null;
  decodeTps: number | null;
  wallTps: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
}

export interface TargetResult {
  id: string;
  target: Target;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  samples: Sample[];
  stats: Stats | null;
  error: string | null;
}

export interface Run {
  id: string;
  createdAt: string;
  finishedAt?: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  config: RunConfig;
  results: TargetResult[];
  error?: string;
  demo?: boolean;
}

export interface Bootstrap {
  version: string;
  demo: boolean;
  models: Model[];
  runs: Run[];
  gateway: { url: string; reachable: boolean; error?: string };
}
