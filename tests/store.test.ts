import { expect, test } from 'bun:test';
import { validateConfig } from '../src/store';
import { EFFORT_OFF } from '../src/types';

const models = [{ id: 'acme/fast', efforts: ['low', 'high'] }];

const config = (effort: string) => ({
  targets: [{ model: 'acme/fast', effort }],
  prompt: 'hello',
  maxTokens: 256,
  repeats: 1,
  deadlineSeconds: 30,
});

test('takes a level the model lists', () => {
  expect(validateConfig(config('high'), models).targets).toEqual([
    { model: 'acme/fast', effort: 'high' },
  ]);
});

test('takes reasoning off wherever a model lists no level of its own', () => {
  expect(validateConfig(config(EFFORT_OFF), models).targets).toEqual([
    { model: 'acme/fast', effort: EFFORT_OFF },
  ]);
});

test('turns away a level the model does not list', () => {
  expect(() => validateConfig(config('max'), models)).toThrow('does not offer reasoning effort');
});
