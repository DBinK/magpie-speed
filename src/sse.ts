/** Yields each SSE `data:` payload from a streamed chat-completions response.
 * The parser tolerates CRLF framing and payloads split across reads. */
export async function* sseEvents(response: Response): AsyncGenerator<string> {
  const stream = response.body;
  if (!stream) throw new Error('Upstream response had no body.');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // Normalize the whole accumulated buffer: a CRLF split across two reads
      // is only visible once both halves are in the buffer.
      if (value) buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let at = buffer.indexOf('\n\n');
      while (at >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
        at = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    const tail = buffer.trim();
    if (tail) {
      const data = tail
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}
