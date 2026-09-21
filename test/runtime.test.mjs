import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplRuntime } from '../src/runtime.mjs';

const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');

function setup(t, options = {}) {
  const calls = [];
  const drivers = [];
  const runtime = new ReplRuntime({ ...options, driverFactory: () => {
    const driver = {
      closed: false,
      async describe(name) { return { name, inputSchema: { properties: {} } }; },
      async call(name, args, signal) {
        calls.push({ name, args });
        if (name === 'wait') await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        if (name === 'picture') return { content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }], structuredContent: { width: 1 } };
        if (name === 'refuse') return { isError: true, content: [{ type: 'text', text: 'Permission denied' }] };
        return { content: [{ type: 'text', text: 'ok' }], structuredContent: { name, args } };
      },
      async close() { this.closed = true; },
    };
    drivers.push(driver);
    return driver;
  } });
  t.after(() => runtime.reset());
  return { runtime, calls, drivers };
}

test('top-level await, lexical variables and functions persist across cells; reset clears them', async t => {
  const { runtime } = setup(t);
  assert.equal((await runtime.evaluate('var counter = await Promise.resolve(40); const twice = x => x * 2;')).isError, false);
  assert.equal(text(await runtime.evaluate('twice(++counter)')), '82');
  await runtime.reset();
  assert.equal(text(await runtime.evaluate('typeof counter')), 'undefined');
});

test('syntax, synchronous and async errors finish promptly and leave ordinary bindings intact', async t => {
  const { runtime } = setup(t);
  await runtime.evaluate('var saved = 7');
  for (const code of ['const =', 'throw new Error("sync")', 'await Promise.reject(new Error("async"))']) {
    const result = await runtime.evaluate(code, { timeoutMs: 1500 });
    assert.equal(result.isError, true);
    assert.doesNotMatch(text(result), /timed out/);
    assert.equal(text(await runtime.evaluate('saved')), '7');
  }
});

test('infinite loop times out in worker and a fresh cell succeeds', async t => {
  const { runtime, drivers } = setup(t);
  const result = await runtime.evaluate('while (true) {}', { timeoutMs: 200 });
  assert.match(text(result), /timed out/);
  assert.equal(drivers[0].closed, true);
  assert.equal(text(await runtime.evaluate('21 * 2')), '42');
});

test('abort cancels an in-flight call and prevents queued actions from reaching the driver', async t => {
  const { runtime, calls } = setup(t);
  const controller = new AbortController();
  const pending = runtime.evaluate('await Promise.all([cua.call("wait"), cua.call("must-not-run")])', { signal: controller.signal });
  while (!calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  assert.match(text(await pending), /cancelled/);
  assert.deepEqual(calls.map(call => call.name), ['wait']);
  assert.equal(text(await runtime.evaluate('1 + 1')), '2');
});

test('cells serialize and return driver images as image blocks without base64 in text', async t => {
  const { runtime } = setup(t);
  const first = runtime.evaluate('var order = []; await new Promise(r => setTimeout(r, 50)); order.push(1)');
  const second = runtime.evaluate('order.push(2); order');
  await first;
  assert.match(text(await second), /1, 2/);
  const result = await runtime.evaluate('await cua.call("picture")');
  assert.equal(result.content[0].type, 'image');
  assert.doesNotMatch(text(result), /aGVsbG8/);
});

test('driver refusals are errors and not silently retried', async t => {
  const { runtime, calls } = setup(t);
  const result = await runtime.evaluate('await cua.call("refuse")');
  assert.equal(result.isError, true);
  assert.match(text(result), /Permission denied/);
  assert.equal(calls.length, 1);
});

test('bounded output reports truncation and preserves errors', async t => {
  const { runtime } = setup(t, { maxTextBytes: 30 });
  const result = await runtime.evaluate('repl.write("x".repeat(100)); throw new Error("visible")');
  assert.match(text(result), /truncated/);
  assert.match(text(result), /visible/);
});

test('delayed RPC from a completed cell cannot act in a later cell', async t => {
  const { runtime, calls } = setup(t);
  await runtime.evaluate('setTimeout(() => { cua.call("late").catch(() => {}); }, 50); undefined');
  await runtime.evaluate('await new Promise(r => setTimeout(r, 120)); 42');
  assert.equal(calls.length, 0);
});

test('reset cancels queued cells instead of executing them in the new session', async t => {
  const { runtime, calls } = setup(t);
  const active = runtime.evaluate('await cua.call("wait")');
  while (!calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  const queued = runtime.evaluate('await cua.call("must-not-run")');
  await runtime.reset();
  assert.equal((await active).isError, true);
  assert.match(text(await queued), /Queued cell cancelled/);
  assert.deepEqual(calls.map(call => call.name), ['wait']);
  assert.equal(text(await runtime.evaluate('42')), '42');
});

test('idle worker exit releases its driver and invalidates old bindings', async t => {
  const { runtime, drivers } = setup(t);
  await runtime.evaluate('var old = 1; setTimeout(() => process.exit(0), 50); undefined');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(drivers[0].closed, true);
  assert.equal(text(await runtime.evaluate('typeof old')), 'undefined');
});
