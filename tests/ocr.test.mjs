import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOcr, fitScale, isOutsideImage, drawWords } from '../public/ocr.js';

const entry = {
  words: '已日',
  location: { top: 23, left: 1031, width: 66, height: 30 },
};

test('accepts the requested words_result schema and preserves source metadata', () => {
  const source = { log_id: 123, words_result: [entry, { words: '3110812026', location: { top: 55, left: 1024, width: 154, height: 45 } }] };
  const parsed = parseOcr(`\uFEFF${JSON.stringify(source)}`);
  assert.deepEqual(parsed.items, source.words_result);
  assert.equal(parsed.data.log_id, 123);
  assert.notEqual(parsed.items[0], source.words_result[0]);
});

test('accepts empty results, empty text, multiline text and fractional coordinates', () => {
  assert.deepEqual(parseOcr({ words_result: [] }).items, []);
  const data = { words_result: [{ words: '', location: { left: 0.5, top: 0, width: 0.5, height: 1 } }, { ...entry, words: '第一行\n第二行' }] };
  assert.deepEqual(parseOcr(data).items, data.words_result);
});

test('rejects invalid JSON and reports the offending item rather than dropping data', () => {
  assert.throws(() => parseOcr('{'), /JSON 格式错误/);
  for (const data of [null, [], {}, { words_result: {} }]) {
    assert.throws(() => parseOcr(data), /words_result/);
  }
  assert.throws(() => parseOcr({ words_result: [entry, { words: 1 }] }), /第 2 项.*words/);
  for (const location of [
    undefined,
    { ...entry.location, top: '23' },
    { ...entry.location, left: -1 },
    { ...entry.location, width: 0 },
    { ...entry.location, height: -1 },
    { ...entry.location, top: Infinity },
  ]) {
    assert.throws(() => parseOcr({ words_result: [{ words: 'test', location }] }), /第 1 项/);
  }
});

test('fits both original dimensions without enlarging small images or returning zero', () => {
  assert.equal(fitScale(1000, 2000, 500, 700), 0.35);
  assert.equal(fitScale(100, 200, 500, 700), 1);
  assert.equal(fitScale(1000, 2000, 0, 0), 0.001);
});

test('detects coordinate and image dimension mismatch', () => {
  assert.equal(isOutsideImage(entry, 1200, 100), false);
  assert.equal(isOutsideImage(entry, 1097, 53), false);
  assert.equal(isOutsideImage(entry, 1096, 100), true);
  assert.equal(isOutsideImage(entry, 1200, 52), true);
});

test('renders text at the original OCR origin and fits multiline text to its box', () => {
  const calls = [];
  const context = {
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    measureText: (text) => ({ width: text.length * 10 }),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
  };
  drawWords(context, [{ words: 'AB\r\nC', location: { left: 20, top: 30, width: 80, height: 40 } }], { color: '#ff0000', opacity: 0.5 });
  assert.equal(context.fillStyle, '#ff0000');
  assert.equal(context.globalAlpha, 0.5);
  assert.ok(calls.some((call) => JSON.stringify(call) === '["translate",20,30]'));
  assert.ok(calls.some((call) => JSON.stringify(call) === '["scale",4,1]'));
  assert.deepEqual(calls.filter(([name]) => name === 'fillText'), [
    ['fillText', 'AB', 0, 10],
    ['fillText', 'C', 0, 30],
  ]);
});
