import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowClockwise,
  CaretRight,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  DownloadSimple,
  Lightning,
  MagnifyingGlass,
  Moon,
  Play,
  Stop,
  Sun,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import type { Bootstrap, Model, Run, Sample, Stats, Target } from '../src/types';
import { DEFAULT_PRESET, PRESETS } from '../src/presets';
import { embedded, subscribeTheme } from './magpie';
import './vendor/magpie-ui.css';
import './style.css';

declare global {
  interface Window {
    __SPEED__?: {
      token?: string;
      initialProvider?: string;
      theme?: string;
      lang?: string;
    };
  }
}

/** A sandboxed Magpie frame has an opaque origin and no storage; prefs are
 * a convenience there, never a requirement for rendering. */
const preferences = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* No storage in the sandboxed frame. */
    }
  },
};

const boot = window.__SPEED__ ?? {};
const token = boot.token;
const apiUrl = (path: string) => new URL(path.replace(/^\//, ''), document.baseURI).toString();

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (res.status === 401) {
    location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const terminal = (run: Run) =>
  run.state === 'completed' || run.state === 'failed' || run.state === 'cancelled';

/** Light guard so a malformed stream cannot crash the page. */
function asRun(value: unknown): Run | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Run>;
  return typeof candidate.id === 'string' &&
    typeof candidate.state === 'string' &&
    Array.isArray(candidate.results) &&
    !!candidate.config
    ? (candidate as Run)
    : null;
}

const truncate = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';
const ms = (value?: number | null) =>
  value === null || value === undefined
    ? '—'
    : value >= 1000
      ? `${(value / 1000).toFixed(2)} s`
      : `${Math.round(value)} ms`;
const tps = (value?: number | null) =>
  value === null || value === undefined ? '—' : truncate(value);
const tokens = (value?: number | null) =>
  value === null || value === undefined ? '—' : Math.round(value).toLocaleString();

const strings = {
  zh: {
    title: '模型测速',
    model: '模型',
    models: '模型与思考深度',
    search: '搜索模型',
    allProviders: '全部提供商',
    prompt: 'Prompt',
    presets: '预制 Prompt',
    custom: '自定义',
    system: '系统提示词（可选）',
    settings: '测量设置',
    repeats: '重复次数',
    maxTokens: '输出上限',
    deadline: '单次超时',
    start: '开始测速',
    stop: '停止',
    cancel: '取消',
    refresh: '刷新模型列表',
    targets: '个目标',
    needTargets: '请至少选择一个模型。',
    running: '测量中',
    queued: '排队中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '已中断',
    results: '测速结果',
    live: '实时进度',
    history: '测速历史',
    noHistory: '还没有历史记录',
    noModels: '没有可用模型',
    gatewayDown: '无法连接 Magpie 网关',
    demo: '示例数据',
    connected: '服务已连接',
    offline: '服务离线',
    median: '中位数',
    ttft: '首字',
    firstAnswer: '首答',
    thinking: '思考',
    outputTps: '输出 tok/s',
    wallTps: '整体 tok/s',
    outputTokens: '输出 tokens',
    reasoningTokens: '思考 tokens',
    total: '总耗时',
    effort: '思考深度',
    defaultEffort: '默认',
    export: '导出',
    delete: '删除',
    repeat: '第 {n} 次',
    estimated: 'token 数为本地估算',
    sampleFailed: '本次失败',
    theme: '切换主题',
    promptChars: '字',
    promptTooLong: 'Prompt 不能超过 20,000 字。',
    historyHint: '点击历史记录查看之前的结果。',
    modelDefault: '模型默认',
    deleteConfirm: '删除这条测速记录？',
    sequential: '重复测量顺序执行，避免并发争用影响速度读数。',
    outputDetail: '输出 tokens / 思考 tokens',
  },
  en: {
    title: 'Model speed',
    model: 'Model',
    models: 'Models and reasoning effort',
    search: 'Search models',
    allProviders: 'All providers',
    prompt: 'Prompt',
    presets: 'Presets',
    custom: 'Custom',
    system: 'System prompt (optional)',
    settings: 'Measurement',
    repeats: 'Repeats',
    maxTokens: 'Max output',
    deadline: 'Timeout',
    start: 'Run test',
    stop: 'Stop',
    cancel: 'Cancel',
    refresh: 'Refresh models',
    targets: 'targets',
    needTargets: 'Select at least one model.',
    running: 'Measuring',
    queued: 'Queued',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    results: 'Results',
    live: 'Live',
    history: 'History',
    noHistory: 'No measurements yet',
    noModels: 'No models available',
    gatewayDown: 'Cannot reach the Magpie gateway',
    demo: 'Demo data',
    connected: 'Service connected',
    offline: 'Service offline',
    median: 'Median',
    ttft: 'TTFT',
    firstAnswer: 'First answer',
    thinking: 'Thinking',
    outputTps: 'Output tok/s',
    wallTps: 'Wall tok/s',
    outputTokens: 'Output tokens',
    reasoningTokens: 'Reasoning tokens',
    total: 'Total',
    effort: 'Reasoning',
    defaultEffort: 'Default',
    export: 'Export',
    delete: 'Delete',
    repeat: 'Run {n}',
    estimated: 'Token counts estimated locally',
    sampleFailed: 'This repeat failed',
    theme: 'Toggle theme',
    promptChars: 'chars',
    promptTooLong: 'Prompt is limited to 20,000 characters.',
    historyHint: 'Pick a saved measurement to revisit its numbers.',
    modelDefault: 'Model default',
    deleteConfirm: 'Delete this measurement?',
    sequential: 'Repeats run sequentially so concurrent quota use cannot skew the numbers.',
    outputDetail: 'Output tokens / reasoning tokens',
  },
} as const;

type Lang = keyof typeof strings;

const STATE_KEYS: Record<
  string,
  'running' | 'queued' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
> = {
  running: 'running',
  queued: 'queued',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
};
const label = (lang: Lang, key: keyof (typeof strings)['zh']) => strings[lang][key];

function sampleRow(lang: Lang, sample: Sample, index: number) {
  return (
    <tr key={index}>
      <td>
        {label(lang, 'repeat').replace('{n}', String(sample.index + 1))}
        {sample.state !== 'done' ? ` · ${sample.state}` : ''}
        {sample.error ? <span className="error"> · {sample.error}</span> : null}
      </td>
      <td>{ms(sample.ttftMs)}</td>
      <td>{ms(sample.firstContentMs)}</td>
      <td>{ms(sample.reasoningMs)}</td>
      <td>{tps(sample.decodeTps)}</td>
      <td>{tokens(sample.outputTokens)}</td>
      <td>{ms(sample.totalMs)}</td>
    </tr>
  );
}

function StatsCells({ stats, title }: { stats: Stats; title: string }) {
  return (
    <>
      <td className="stat-big">{ms(stats.ttftMs)}</td>
      <td>{ms(stats.firstContentMs)}</td>
      <td>{ms(stats.reasoningMs)}</td>
      <td className="stat-big">{tps(stats.decodeTps)}</td>
      <td>{tps(stats.wallTps)}</td>
      <td title={title}>
        {tokens(stats.outputTokens)}
        {stats.reasoningTokens ? (
          <span className="muted"> / {tokens(stats.reasoningTokens)}</span>
        ) : null}
      </td>
      <td>{ms(stats.totalMs)}</td>
    </>
  );
}

function App() {
  const [lang, setLang] = useState<Lang>(boot.lang && !boot.lang.startsWith('zh') ? 'en' : 'zh');
  const [dark, setDark] = useState(
    boot.theme ? boot.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(boot.initialProvider || '');
  const [prompt, setPrompt] = useState(
    () => preferences.get('magpie-speed.prompt') ?? DEFAULT_PRESET.prompt,
  );
  const [system, setSystem] = useState('');
  const [maxTokens, setMaxTokens] = useState(2048);
  const [repeats, setRepeats] = useState(3);
  const [deadlineSeconds, setDeadline] = useState(120);
  const [run, setRun] = useState<Run | null>(null);
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const t = (key: keyof (typeof strings)['zh']) => label(lang, key);

  const refresh = useCallback(async () => {
    try {
      const next = await api<Bootstrap>('api/bootstrap');
      setData(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    preferences.set('magpie-speed.prompt', prompt);
  }, [prompt]);

  useEffect(() => {
    if (!embedded) document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    if (!embedded) return;
    return subscribeTheme((theme) => {
      setDark(theme.dark);
      setLang(theme.lang.startsWith('zh') ? 'zh' : 'en');
    });
  }, []);

  const watch = useCallback(
    async (id: string) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      try {
        const res = await fetch(apiUrl(`api/runs/${id}/events`), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Live update failed: HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let at = buffer.indexOf('\n\n');
          while (at >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const payload = block
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (payload) {
              const next = asRun(JSON.parse(payload));
              if (next) {
                setRun(next);
                if (terminal(next)) void refresh();
              }
            }
            at = buffer.indexOf('\n\n');
          }
          if (done) break;
        }
      } catch (err) {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  useEffect(() => () => controller.current?.abort(), []);

  const models = data?.models ?? [];
  const providers = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter((m) => !provider || m.provider === provider)
      .filter(
        (m) =>
          !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [models, provider, query]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Model[]>();
    for (const model of visible) {
      const list = groups.get(model.provider) ?? [];
      list.push(model);
      groups.set(model.provider, list);
    }
    return [...groups.entries()];
  }, [visible]);

  const selectedModelIds = useMemo(() => new Set(targets.map((target) => target.model)), [targets]);
  const running = !!run && !terminal(run);
  const promptPreset = PRESETS.find((preset) => preset.prompt === prompt)?.id;

  const toggleModel = (model: Model) =>
    setTargets((prev) =>
      prev.some((target) => target.model === model.id)
        ? prev.filter((target) => target.model !== model.id)
        : [...prev, { model: model.id, effort: '' }],
    );

  const setEffort = (model: string, effort: string) =>
    setTargets((prev) =>
      prev.map((target) => (target.model === model ? { ...target, effort } : target)),
    );

  const start = async () => {
    if (running || busy) return;
    if (!targets.length) {
      setError(t('needTargets'));
      return;
    }
    if (prompt.trim().length > 20000) {
      setError(t('promptTooLong'));
      return;
    }
    setBusy(true);
    setError('');
    setRun(null);
    try {
      const created = await api<Run>('api/runs', {
        method: 'POST',
        body: JSON.stringify({
          targets,
          prompt,
          system,
          maxTokens,
          repeats,
          deadlineSeconds,
        }),
      });
      setRun(created);
      void watch(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    try {
      await api(`api/runs/${run.id}/cancel`, { method: 'POST' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    try {
      await api(`api/runs/${id}`, { method: 'DELETE' });
      if (run?.id === id) setRun(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportRun = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `magpie-speed-${run.id}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const stateLabel = (state: string) => {
    const key = STATE_KEYS[state];
    return key ? t(key) : state;
  };

  return (
    <div className={`app${data?.runs?.length ? '' : ' no-history'}`}>
      {data?.runs?.length ? (
        <aside className="history">
          <h2>
            <ClockCounterClockwise size={14} /> {t('history')}
          </h2>
          {data.runs.map((item) => (
            <button
              key={item.id}
              className="history-entry"
              aria-current={run?.id === item.id}
              onClick={() => {
                controller.current?.abort();
                setRun(item);
              }}
            >
              <span className="who">
                {item.config.targets.map((target) => target.model.split('/')[1]).join(', ')}
              </span>
              <span className="sub">
                {new Date(item.createdAt).toLocaleString()}
                {item.demo ? ` · ${t('demo')}` : ''}
              </span>
              <span className="sub">{stateLabel(item.state)}</span>
            </button>
          ))}
        </aside>
      ) : null}

      <main className="main">
        <header className="top">
          <h1>{t('title')}</h1>
          {data?.gateway.reachable ? (
            <span className="pill ok">
              <CheckCircle size={12} /> {t('connected')}
            </span>
          ) : (
            <span className="pill bad">
              <WarningCircle size={12} /> {t('offline')}
            </span>
          )}
          {data?.demo ? <span className="pill">{t('demo')}</span> : null}
          <span className="spacer" />
          {!embedded ? (
            <>
              <button className="icon-button" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
                {lang === 'zh' ? 'EN' : '中'}
              </button>
              <button
                className="icon-button"
                title={t('theme')}
                onClick={() => setDark((value) => !value)}
              >
                {dark ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </>
          ) : null}
          <button
            className="icon-button"
            title={t('refresh')}
            disabled={running}
            onClick={() => {
              void (async () => {
                try {
                  await api('api/catalog', { method: 'POST' });
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              })();
            }}
          >
            <ArrowClockwise size={14} />
          </button>
        </header>

        {data && !data.gateway.reachable ? (
          <p className="error">
            {t('gatewayDown')}: {data.gateway.error}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="layout">
          <section className="card">
            <h2>{t('models')}</h2>
            <div className="field-row">
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="">{t('allProviders')}</option>
                {providers.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="search" style={{ gridColumn: 'span 2' }}>
                <MagnifyingGlass size={13} />
                <input
                  type="search"
                  placeholder={t('search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            {targets.length ? (
              <div className="chips">
                {targets.map((target) => (
                  <span key={target.model} className="chip">
                    {target.model.split('/')[1]}
                    {target.effort ? ` · ${target.effort}` : ''}
                    <button
                      className="remove"
                      aria-label="remove"
                      onClick={() =>
                        setTargets((prev) => prev.filter((row) => row.model !== target.model))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="model-list">
              {grouped.length ? (
                grouped.map(([group, rows]) => (
                  <div key={group}>
                    <div className="group-label">{group}</div>
                    {rows.map((model) => (
                      <div
                        className={`model-item${selectedModelIds.has(model.id) ? ' on' : ''}`}
                        key={model.id}
                      >
                        <input
                          type="checkbox"
                          checked={selectedModelIds.has(model.id)}
                          onChange={() => toggleModel(model)}
                        />
                        <span className="name" title={`${model.id} · ${model.name}`}>
                          {model.name}
                          <span className="provider"> · {model.provider}</span>
                        </span>
                        <select
                          aria-label={t('effort')}
                          disabled={!selectedModelIds.has(model.id)}
                          value={targets.find((target) => target.model === model.id)?.effort ?? ''}
                          onChange={(event) => setEffort(model.id, event.target.value)}
                        >
                          <option value="">{t('defaultEffort')}</option>
                          {model.efforts.map((effort) => (
                            <option key={effort} value={effort}>
                              {effort}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <div className="empty">{t('noModels')}</div>
              )}
            </div>

            <h2>{t('prompt')}</h2>
            <div className="chips">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="chip"
                  aria-pressed={promptPreset === preset.id}
                  title={preset.description}
                  onClick={() => setPrompt(preset.prompt)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              spellCheck={false}
            />
            <div className="hint">
              {prompt.length} {t('promptChars')}
            </div>
            <details>
              <summary className="hint">{t('system')}</summary>
              <textarea
                rows={3}
                value={system}
                onChange={(event) => setSystem(event.target.value)}
              />
            </details>

            <h2>{t('settings')}</h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor="repeats">{t('repeats')}</label>
                <select
                  id="repeats"
                  value={repeats}
                  onChange={(event) => setRepeats(Number(event.target.value))}
                >
                  {[1, 3, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="maxTokens">{t('maxTokens')}</label>
                <select
                  id="maxTokens"
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(Number(event.target.value))}
                >
                  {[512, 1024, 2048, 4096, 8192].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="deadline">{t('deadline')}</label>
                <select
                  id="deadline"
                  value={deadlineSeconds}
                  onChange={(event) => setDeadline(Number(event.target.value))}
                >
                  {[30, 60, 120, 300, 600].map((value) => (
                    <option key={value} value={value}>
                      {value}s
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="actions">
              {running ? (
                <button className="primary" onClick={() => void cancel()}>
                  <Stop size={14} /> {t('stop')}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy || !targets.length}
                  onClick={() => void start()}
                >
                  {busy ? <CircleNotch size={14} className="spin" /> : <Play size={14} />}{' '}
                  {t('start')}
                </button>
              )}
              <span className="hint">
                {targets.length} {t('targets')} · {t('repeats')} {repeats}
              </span>
            </div>
          </section>

          <section className="card" style={{ minWidth: 0 }}>
            <div className="actions">
              <h2 style={{ margin: 0 }}>{t('results')}</h2>
              <span className="spacer" />
              {run ? (
                <>
                  <span className="hint">
                    {new Date(run.createdAt).toLocaleString()} · {stateLabel(run.state)}
                    {run.demo ? ` · ${t('demo')}` : ''}
                  </span>
                  <button className="secondary" onClick={exportRun}>
                    <DownloadSimple size={13} /> {t('export')}
                  </button>
                  {run.state !== 'running' && run.state !== 'queued' ? (
                    <button className="secondary" onClick={() => void remove(run.id)}>
                      <Trash size={13} />
                    </button>
                  ) : null}
                </>
              ) : (
                <span className="hint">{t('historyHint')}</span>
              )}
            </div>

            {run?.error ? <p className="error">{run.error}</p> : null}

            {run ? (
              <>
                <div className="progress">
                  {run.results.map((result) => {
                    const live = result.samples.find((sample) => sample.state === 'streaming');
                    const shown =
                      live ??
                      [...result.samples].reverse().find((sample) => sample.state === 'done');
                    const done = result.samples.filter((sample) => sample.state === 'done').length;
                    return (
                      <div className="target-row" key={result.id}>
                        <div className="title">
                          {result.state === 'running' ? (
                            <CircleNotch size={13} className="spin" />
                          ) : result.state === 'completed' ? (
                            <CheckCircle size={13} style={{ color: 'var(--good)' }} />
                          ) : result.state === 'failed' ? (
                            <WarningCircle size={13} style={{ color: 'var(--bad)' }} />
                          ) : (
                            <CaretRight size={13} />
                          )}
                          <strong>{result.target.model}</strong>
                          <span className="pill">{result.target.effort || t('modelDefault')}</span>
                          <span className="spacer" />
                          <span className="hint">
                            {done}/{result.samples.length} · {stateLabel(result.state)}
                          </span>
                        </div>
                        {shown ? (
                          <div className="metrics">
                            <span>
                              {t('ttft')} <b>{ms(shown.ttftMs)}</b>
                            </span>
                            <span>
                              {t('firstAnswer')} <b>{ms(shown.firstContentMs)}</b>
                            </span>
                            <span>
                              {t('outputTps')} <b>{tps(shown.decodeTps)}</b>
                            </span>
                            <span>
                              {t('outputTokens')} <b>{tokens(shown.outputTokens)}</b>
                            </span>
                            <span>
                              {t('total')} <b>{ms(shown.totalMs)}</b>
                            </span>
                          </div>
                        ) : result.error ? (
                          <span className="error">{result.error}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {run.results.some((result) => result.stats) ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t('model')}</th>
                          <th>{t('ttft')}</th>
                          <th>{t('firstAnswer')}</th>
                          <th>{t('thinking')}</th>
                          <th>{t('outputTps')}</th>
                          <th>{t('wallTps')}</th>
                          <th>{t('outputTokens')}</th>
                          <th>{t('total')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.results.map((result) => (
                          <React.Fragment key={result.id}>
                            <tr
                              className="expandable"
                              onClick={() =>
                                setExpanded((prev) => {
                                  const next = { ...prev };
                                  if (next[result.id]) delete next[result.id];
                                  else next[result.id] = true;
                                  return next;
                                })
                              }
                            >
                              <td>
                                <div className="model-name">
                                  {result.target.model.split('/')[1]}
                                </div>
                                <div className="model-provider">
                                  {result.target.model.split('/')[0]} ·{' '}
                                  {result.target.effort || t('modelDefault')}
                                </div>
                              </td>
                              {result.stats ? (
                                <StatsCells stats={result.stats} title={t('outputDetail')} />
                              ) : (
                                <td colSpan={7} className="muted">
                                  {result.error || stateLabel(result.state)}
                                </td>
                              )}
                            </tr>
                            {expanded[result.id] ? (
                              <tr className="detail">
                                <td colSpan={8}>
                                  <table className="detail-table">
                                    <thead>
                                      <tr>
                                        <th></th>
                                        <th>{t('ttft')}</th>
                                        <th>{t('firstAnswer')}</th>
                                        <th>{t('thinking')}</th>
                                        <th>{t('outputTps')}</th>
                                        <th>{t('outputTokens')}</th>
                                        <th>{t('total')}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {result.samples.map((sample, index) =>
                                        sampleRow(lang, sample, index),
                                      )}
                                    </tbody>
                                  </table>
                                  {result.samples.some((sample) => sample.estimated) ? (
                                    <div className="hint">{t('estimated')}</div>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                    <p className="footer-note">
                      {t('median')} · {run.config.repeats} {t('repeats')} ×{' '}
                      {run.config.targets.length} {t('targets')}. {t('sequential')}
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty">
                <Lightning size={18} />
                <div>
                  {lang === 'zh' ? '选择模型后开始测量。' : 'Pick models and start a measurement.'}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
