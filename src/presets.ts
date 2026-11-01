export interface Preset {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

/** Prompts are fixed so repeated measurements stay comparable; they ask for
 * enough output to expose decode speed rather than only start-up latency. */
export const PRESETS: Preset[] = [
  {
    id: 'essay',
    name: '短文',
    description: '约 600 字中文说明文，输出长度稳定',
    prompt:
      '请用中文写一篇约 600 字的说明文，主题：为什么首字延迟比吞吐量更影响聊天体验。分段论述，不要使用列表或标题。',
  },
  {
    id: 'code',
    name: '代码',
    description: '生成一段完整实现，覆盖较长输出',
    prompt:
      '用 TypeScript 实现一个支持并发上限、重试和超时的请求队列，包含完整代码和简短使用示例。不要省略实现细节。',
  },
  {
    id: 'reasoning',
    name: '推理',
    description: '需要多步计算，便于观察思考耗时',
    prompt:
      '一个水池有两个进水管和一个出水管。甲管单独注满需要 6 小时，乙管需要 8 小时，出水管排空需要 12 小时。三管同时打开，多久能注满水池？请给出完整推导过程。',
  },
];

export const DEFAULT_PRESET = PRESETS[0];
