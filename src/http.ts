export class BodyTooLargeError extends Error {}

export async function boundedText(
  body: BodyInit | Response | null,
  limit: number,
): Promise<string> {
  if (!body) return '';
  if (typeof body === 'string') {
    if (body.length > limit) throw new BodyTooLargeError('Body too large');
    return body;
  }
  const stream =
    body instanceof ReadableStream
      ? body
      : body instanceof Response
        ? body.body
        : new Response(body).body;
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > limit) throw new BodyTooLargeError('Body too large');
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}
