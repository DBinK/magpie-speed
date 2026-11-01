import { expect, test } from 'bun:test';
import { sseEvents } from '../src/sse';

const streamOf = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );

const collect = async (response: Response) => {
  const events: string[] = [];
  for await (const event of sseEvents(response)) events.push(event);
  return events;
};

test('parses events split across reads', async () => {
  const events = await collect(
    streamOf(['data: {"a":', '1}\n\ndata: {"b":2}\n', '\ndata: [DONE]\n\n']),
  );
  expect(events).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
});

test('tolerates CRLF framing and comment lines', async () => {
  const events = await collect(
    streamOf([': keepalive\r\n\r\n', 'data: first\r\ndata: second\r\n\r\n']),
  );
  expect(events).toEqual(['first\nsecond']);
});

test('yields a final event without a trailing blank line', async () => {
  expect(await collect(streamOf(['data: tail']))).toEqual(['tail']);
});

test('frames CRLF delimiters that are split byte by byte across reads', async () => {
  const wire = 'data: one\r\n\r\ndata: two\r\n\r\ndata: [DONE]\r\n\r\n';
  const events = await collect(streamOf([...wire]));
  expect(events).toEqual(['one', 'two', '[DONE]']);
});
