import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowClockwise,
  CaretRight,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  DownloadSimple,
  MagnifyingGlass,
  Moon,
  Play,
  Stop,
  Sun,
  Trash,
  WarningCircle,
  X,
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

const boot = window.__SPEED__ ?? {};
const token = boot.token;
const apiUrl = (path: string) => new URL(path.replace(/^\//, ''), document.baseURI).toString();

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
    tagline: '首字延迟 · 输出吞吐',
    selectModels: '选择模型',
    model: '模型',
    search: '搜索模型',
    allProviders: '全部提供商',
    selectHint: '点右侧思考深度会同时选中模型',
    clear: '清空',
    prompt: 'Prompt',
    presets: '预制',
    system: '系统提示词（可选）',
    advanced: '高级选项',
    repeats: '重复',
    maxTokens: '输出上限',
    deadline: '超时',
    start: '开始测速',
    stop: '停止',
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
    history: '测速历史',
    historyEmpty: '还没有测速记录',
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
    theme: '切换主题',
    promptChars: '字',
    promptTooLong: 'Prompt 不能超过 20,000 字。',
    historyHint: '从右上角打开测速历史。',
    modelDefault: '模型默认',
    deleteConfirm: '删除这条测速记录？',
    sequential: '重复测量顺序执行，避免并发争用影响读数。',
    outputDetail: '输出 tokens / 思考 tokens',
    close: '关闭',
    viewingHistory: '历史记录',
    backToLatest: '返回',
    emptyResults: '选好模型和思考深度后开始测量。',
    progress: '正在测量 {model} · {done}/{total}',
    ready: '准备就绪',
    summary: '{n} 个目标 · 重复 {r} 次',
    noTargets: '尚未选择模型',
    historyCount: '条',
    clearSelection: '清空选择',
    groupProviders: '提供商',
  },
  en: {
    title: 'Model speed',
    tagline: 'TTFT · output throughput',
    selectModels: 'Models',
    model: 'Model',
    search: 'Search models',
    allProviders: 'All providers',
    selectHint: 'Choosing an effort also selects the model',
    clear: 'Clear',
    prompt: 'Prompt',
    presets: 'Presets',
    system: 'System prompt (optional)',
    advanced: 'Advanced',
    repeats: 'Repeats',
    maxTokens: 'Max output',
    deadline: 'Timeout',
    start: 'Run test',
    stop: 'Stop',
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
    history: 'History',
    historyEmpty: 'No measurements yet',
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
    theme: 'Toggle theme',
    promptChars: 'chars',
    promptTooLong: 'Prompt is limited to 20,000 characters.',
    historyHint: 'Open history from the top right.',
    modelDefault: 'Model default',
    deleteConfirm: 'Delete this measurement?',
    sequential: 'Repeats run sequentially so concurrent quota use cannot skew the numbers.',
    outputDetail: 'Output tokens / reasoning tokens',
    close: 'Close',
    viewingHistory: 'History',
    backToLatest: 'Back',
    emptyResults: 'Pick models and a reasoning effort, then run a measurement.',
    progress: 'Measuring {model} · {done}/{total}',
    ready: 'Ready',
    summary: '{n} targets · {r} repeats',
    noTargets: 'No models selected',
    historyCount: 'saved',
    clearSelection: 'Clear selection',
    groupProviders: 'Providers',
  },
} as const;

type Lang = keyof typeof strings;
type StringKey = keyof (typeof strings)['zh'];
const label = (lang: Lang, key: StringKey) => strings[lang][key];

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

function SampleRow({ lang, sample }: { lang: Lang; sample: Sample }) {
  return (
    <tr>
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

function StatsCells({ stats, title, rate }: { stats: Stats; title: string; rate: number }) {
  return (
    <>
      <td className="stat-big">{ms(stats.ttftMs)}</td>
      <td>{ms(stats.firstContentMs)}</td>
      <td>{ms(stats.reasoningMs)}</td>
      <td className="rate-cell">
        <span className="bar" style={{ width: `${rate}%` }} />
        <span className="value stat-big">{tps(stats.decodeTps)}</span>
      </td>
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
  // The live measurement and the record being read are separate: browsing
  // history must never hide a running task or its cancel button.
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [historyRun, setHistoryRun] = useState<Run | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const t = (key: StringKey) => label(lang, key);
  const stateLabel = (state: string) => {
    const key = STATE_KEYS[state];
    return key ? t(key) : state;
  };

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

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen]);

  useEffect(() => () => controller.current?.abort(), []);

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
                setActiveRun(next);
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

  const selected = useMemo(
    () => new Map(targets.map((target) => [target.model, target.effort])),
    [targets],
  );
  const run = historyRun ?? activeRun;
  const viewingHistory = historyRun !== null;
  const running = !!activeRun && !terminal(activeRun);
  const promptPreset = PRESETS.find((preset) => preset.prompt === prompt)?.id;
  const historyCount = data?.runs.length ?? 0;

  const toggleModel = (model: Model) =>
    setTargets((prev) =>
      prev.some((target) => target.model === model.id)
        ? prev.filter((target) => target.model !== model.id)
        : [...prev, { model: model.id, effort: '' }],
    );

  const chooseEffort = (model: Model, effort: string) =>
    setTargets((prev) =>
      prev.some((target) => target.model === model.id)
        ? prev.map((target) => (target.model === model.id ? { ...target, effort } : target))
        : [...prev, { model: model.id, effort }],
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
    setActiveRun(null);
    setHistoryRun(null);
    setExpanded({});
    try {
      const created = await api<Run>('api/runs', {
        method: 'POST',
        body: JSON.stringify({ targets, prompt, system, maxTokens, repeats, deadlineSeconds }),
      });
      setActiveRun(created);
      void watch(created.id);
      requestAnimationFrame(() =>
        document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!activeRun) return;
    try {
      await api(`api/runs/${activeRun.id}/cancel`, { method: 'POST' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    try {
      await api(`api/runs/${id}`, { method: 'DELETE' });
      if (historyRun?.id === id) setHistoryRun(null);
      if (activeRun?.id === id) setActiveRun(null);
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

  const progress = useMemo(() => {
    if (!activeRun || !running) return t('ready');
    const current = activeRun.results.find((result) => result.state === 'running');
    if (!current) return t('running');
    const done = current.samples.filter((sample) => sample.state === 'done').length;
    return t('progress')
      .replace('{model}', current.target.model.split('/')[1])
      .replace('{done}', String(done))
      .replace('{total}', String(current.samples.length));
  }, [run, running, lang]);

  const maxRate = Math.max(
    1,
    ...(run?.results.map((result) => result.stats?.decodeTps ?? 0) ?? [0]),
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>{t('title')}</h1>
          <span className="tagline">{t('tagline')}</span>
        </div>
        {data?.gateway.reachable ? (
          <span className="pill ok" title={t('connected')}>
            <CheckCircle size={12} />
            <span className="pill-text">{t('connected')}</span>
          </span>
        ) : (
          <span className="pill bad" title={t('offline')}>
            <WarningCircle size={12} />
            <span className="pill-text">{t('offline')}</span>
          </span>
        )}
        {data?.demo ? <span className="pill">{t('demo')}</span> : null}
        <span className="spacer" />
        <button
          className="icon-button"
          aria-expanded={historyOpen}
          title={t('history')}
          onClick={() => setHistoryOpen(true)}
        >
          <ClockCounterClockwise size={14} />
          <span className="badge">{historyCount}</span>
        </button>
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
      </header>

      <main>
        {data && !data.gateway.reachable ? (
          <p className="error">
            {t('gatewayDown')}: {data.gateway.error}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}

        <section className="panel">
          <div className="panel-head">
            <h2>{t('selectModels')}</h2>
            <span className="hint">{t('selectHint')}</span>
            <div className="tools">
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="">{t('allProviders')}</option>
                {providers.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="search">
                <MagnifyingGlass size={13} />
                <input
                  type="search"
                  placeholder={t('search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="summary-line">
            {targets.length ? (
              <>
                <strong>
                  {t('summary')
                    .replace('{n}', String(targets.length))
                    .replace('{r}', String(repeats))}
                </strong>
                <span>
                  {targets
                    .map((target) => {
                      const model = models.find((item) => item.id === target.model);
                      return `${model?.name ?? target.model.split('/')[1]}${
                        target.effort ? ` · ${target.effort}` : ''
                      }`;
                    })
                    .join('，')}
                </span>
                <button className="ghost-button" onClick={() => setTargets([])}>
                  {t('clearSelection')}
                </button>
              </>
            ) : (
              <span>{t('noTargets')}</span>
            )}
          </div>

          <div className="model-list">
            {grouped.length ? (
              grouped.map(([group, rows]) => (
                <div key={group}>
                  <div className="group-label">{group}</div>
                  {rows.map((model) => {
                    const effort = selected.get(model.id);
                    const on = effort !== undefined;
                    return (
                      <div className={`model-row${on ? ' on' : ''}`} key={model.id}>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={model.name}
                          onChange={() => toggleModel(model)}
                        />
                        <div className="model-name">
                          <span className="name" title={model.id}>
                            {model.name}
                          </span>
                          <span className="provider">{model.provider}</span>
                        </div>
                        <div className="efforts" role="group" aria-label={t('effort')}>
                          <button
                            className="chip"
                            aria-pressed={on && effort === ''}
                            onClick={() => chooseEffort(model, '')}
                          >
                            {t('defaultEffort')}
                          </button>
                          {model.efforts.map((level) => (
                            <button
                              key={level}
                              className="chip"
                              aria-pressed={on && effort === level}
                              onClick={() => chooseEffort(model, level)}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="empty">{t('noModels')}</div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t('prompt')}</h2>
            <div className="tools chips">
              <span className="hint">{t('presets')}</span>
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
            <summary>{t('advanced')}</summary>
            <div className="field-row" style={{ marginTop: 8 }}>
              <label className="hint" htmlFor="system" style={{ alignSelf: 'center' }}>
                {t('system')}
              </label>
            </div>
            <textarea
              id="system"
              rows={3}
              value={system}
              onChange={(event) => setSystem(event.target.value)}
            />
          </details>
        </section>

        <section className="panel" id="results">
          <div className="panel-head">
            <h2>{t('results')}</h2>
            {viewingHistory ? <span className="pill history">{t('viewingHistory')}</span> : null}
            {run ? (
              <>
                <span className="hint">
                  {new Date(run.createdAt).toLocaleString()} · {stateLabel(run.state)}
                  {run.demo ? ` · ${t('demo')}` : ''}
                </span>
                <div className="tools">
                  {viewingHistory ? (
                    <button
                      className="secondary"
                      onClick={() => {
                        setHistoryRun(null);
                        setExpanded({});
                      }}
                    >
                      {t('backToLatest')}
                    </button>
                  ) : null}
                  <button className="secondary" onClick={exportRun}>
                    <DownloadSimple size={13} /> {t('export')}
                  </button>
                  {run.state !== 'running' && run.state !== 'queued' ? (
                    <button className="secondary" onClick={() => void remove(run.id)}>
                      <Trash size={13} />
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <span className="hint">{t('historyHint')}</span>
            )}
          </div>

          {run?.error ? <p className="error">{run.error}</p> : null}

          {run ? (
            <>
              {running || !run.results.some((result) => result.stats) ? (
                <div className="targets-live">
                  {run.results.map((result) => {
                    const live = result.samples.find((sample) => sample.state === 'streaming');
                    const shown =
                      live ??
                      [...result.samples].reverse().find((sample) => sample.state === 'done');
                    const done = result.samples.filter((sample) => sample.state === 'done').length;
                    return (
                      <div className="target-card" key={result.id}>
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
                          <strong>{result.target.model.split('/')[1]}</strong>
                          <span className="effort">
                            {result.target.effort || t('modelDefault')}
                          </span>
                          <span className="spacer" />
                          <span className="hint">
                            {done}/{result.samples.length}
                          </span>
                        </div>
                        {shown ? (
                          <div className="metrics">
                            <span>
                              {t('ttft')} <b>{ms(shown.ttftMs)}</b>
                            </span>
                            <span>
                              {t('outputTps')} <b>{tps(shown.decodeTps)}</b>
                            </span>
                            <span>
                              {t('outputTokens')} <b>{tokens(shown.outputTokens)}</b>
                            </span>
                          </div>
                        ) : result.error ? (
                          <span className="error">{result.error}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {run.results.some((result) => result.stats) ? (
                <div className="table-wrap">
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
                      {run.results.map((result) => {
                        const rate = result.stats?.decodeTps
                          ? Math.max(4, (result.stats.decodeTps / maxRate) * 100)
                          : 0;
                        return (
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
                                <div className="model-sub">
                                  {result.target.model.split('/')[0]} ·{' '}
                                  {result.target.effort || t('modelDefault')}
                                </div>
                              </td>
                              {result.stats ? (
                                <StatsCells
                                  stats={result.stats}
                                  title={t('outputDetail')}
                                  rate={rate}
                                />
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
                                        <th />
                                        <th>{t('ttft')}</th>
                                        <th>{t('firstAnswer')}</th>
                                        <th>{t('thinking')}</th>
                                        <th>{t('outputTps')}</th>
                                        <th>{t('outputTokens')}</th>
                                        <th>{t('total')}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {result.samples.map((sample) => (
                                        <SampleRow key={sample.index} lang={lang} sample={sample} />
                                      ))}
                                    </tbody>
                                  </table>
                                  {result.samples.some((sample) => sample.estimated) ? (
                                    <div className="hint">{t('estimated')}</div>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
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
            <div className="empty">{t('emptyResults')}</div>
          )}
        </section>
      </main>

      <div className="runbar">
        <div className="runbar-inner">
          <div className="who">
            <strong>
              {targets.length
                ? t('summary')
                    .replace('{n}', String(targets.length))
                    .replace('{r}', String(repeats))
                : t('noTargets')}
            </strong>
            <span>{progress}</span>
          </div>
          <div className="controls">
            <div className="seg" role="group" aria-label={t('repeats')}>
              {[1, 3, 5].map((value) => (
                <button
                  key={value}
                  aria-pressed={repeats === value}
                  onClick={() => setRepeats(value)}
                  disabled={running}
                >
                  {value}
                </button>
              ))}
            </div>
            <select
              aria-label={t('maxTokens')}
              value={maxTokens}
              disabled={running}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
            >
              {[512, 1024, 2048, 4096, 8192].map((value) => (
                <option key={value} value={value}>
                  {value} tok
                </option>
              ))}
            </select>
            <select
              aria-label={t('deadline')}
              value={deadlineSeconds}
              disabled={running}
              onChange={(event) => setDeadline(Number(event.target.value))}
            >
              {[30, 60, 120, 300, 600].map((value) => (
                <option key={value} value={value}>
                  {value}s
                </option>
              ))}
            </select>
            {running ? (
              <button className="primary stop" onClick={() => void cancel()}>
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
          </div>
        </div>
      </div>

      {historyOpen ? (
        <div className="backdrop" onMouseDown={() => setHistoryOpen(false)}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('history')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2>{t('history')}</h2>
              <span className="pill">
                {historyCount} {t('historyCount')}
              </span>
              <span className="spacer" />
              <button
                className="icon-button"
                autoFocus
                aria-label={t('close')}
                onClick={() => setHistoryOpen(false)}
              >
                <X size={14} />
              </button>
            </header>
            <div className="list">
              {data?.runs.length ? (
                data.runs.map((item) => (
                  <div key={item.id} className="history-entry" aria-current={run?.id === item.id}>
                    <button
                      className="body"
                      onClick={() => {
                        // The entry that is still measuring belongs to the live
                        // view; a frozen snapshot would stop following it.
                        setHistoryRun(activeRun?.id === item.id ? null : item);
                        setExpanded({});
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="who">
                        {item.config.targets
                          .map(
                            (target) =>
                              `${target.model.split('/')[1]}${target.effort ? ` · ${target.effort}` : ''}`,
                          )
                          .join(', ')}
                      </span>
                      <span className="sub">
                        {new Date(item.createdAt).toLocaleString()}
                        <span>·</span>
                        <span>{stateLabel(item.state)}</span>
                        {item.demo ? <span>· {t('demo')}</span> : null}
                      </span>
                    </button>
                    {item.state !== 'running' && item.state !== 'queued' ? (
                      <button
                        className="delete"
                        aria-label={t('delete')}
                        onClick={() => void remove(item.id)}
                      >
                        <Trash size={13} />
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty">{t('historyEmpty')}</div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
