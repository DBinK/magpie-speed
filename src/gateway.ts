import type { Model } from './types';
import { boundedText } from './http';
import { list, object, text } from './json';

export class Gateway {
  constructor(
    readonly url: string,
    private key = '',
  ) {}

  headers(extra: Record<string, string> = {}) {
    return {
      'content-type': 'application/json',
      'user-agent': 'MagpieSpeed/0.1.0',
      ...(this.key ? { authorization: `Bearer ${this.key}` } : {}),
      ...extra,
    };
  }

  redact(message: unknown) {
    return String(message instanceof Error ? message.message : message)
      .replaceAll(this.key || '\u0000', '[redacted]')
      .slice(0, 500);
  }

  async catalog(): Promise<Model[]> {
    const res = await fetch(`${this.url}/v1/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Magpie model catalog returned HTTP ${res.status}.`);
    }
    const payload: unknown = JSON.parse(await boundedText(res, 4 * 1024 * 1024));
    return list(object(payload).data)
      .map(object)
      .filter((m) => {
        const id = text(m.id);
        if (!id || !id.includes('/') || id.startsWith('group/')) return false;
        if (/^(embedding|image|audio)(_|$)/.test(text(m.type) ?? '')) return false;
        const output = list(object(m.modalities).output);
        if (output.length && !output.includes('text')) return false;
        const native = list(m.native_endpoints);
        return (
          !native.length ||
          !native.every(
            (endpoint) =>
              typeof endpoint === 'string' && /\/(images|embeddings|audio)\b/.test(endpoint),
          )
        );
      })
      .map((m) => {
        const id = text(m.id)!;
        const levels = list(m.reasoning_levels);
        return {
          id,
          name: text(m.display_name) || text(m.name) || id,
          provider: id.split('/')[0],
          efforts: (levels.length
            ? levels
            : list(m.supported_reasoning_levels).map((level) => object(level).effort)
          ).filter((effort): effort is string => typeof effort === 'string'),
        };
      });
  }

  /** One streamed chat request. The caller owns timing and cancellation. */
  chat(body: Record<string, unknown>, signal: AbortSignal, session?: string): Promise<Response> {
    return fetch(`${this.url}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(session ? { 'x-magpie-session': session } : {}),
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  }
}
