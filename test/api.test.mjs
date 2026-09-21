import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.mjs';

function setup({ duplicate = false } = {}) {
  const calls = [];
  const rpc = async (method, { name, args }) => {
    if (method === 'describe') return { inputSchema: { properties: { target: {} } } };
    calls.push({ name, args });
    let data = {};
    if (name === 'list_apps') data = { apps: [{ name: 'Calculator', pid: 10, running: true }, ...(duplicate ? [{ name: 'Calculator', pid: 11, running: true }] : [])] };
    if (name === 'list_windows') data = { windows: [{ pid: 10, window_id: 20, title: 'Calculator' }] };
    if (name === 'get_browser_state' && args.pid) data = { target_id: 'target1', tabs: [{ tab_id: 'tab1', title: 'Example' }] };
    return { content: [], structuredContent: data };
  };
  return { cua: createApi(rpc, () => {}), calls };
}

test('app handles require unique running app, window ownership and safe numeric IDs', async () => {
  const { cua } = setup({ duplicate: true });
  await assert.rejects(cua.getApp('Calculator'), /found 2/);
  const app = await cua.getApp(10);
  await assert.rejects(app.getWindow(999), /does not belong/);
  await assert.rejects(app.getWindow(2 ** 54), /safely representable/);
});

test('window methods bind their own target even if caller supplies a different one', async () => {
  const { cua, calls } = setup();
  const app = await cua.getApp('Calculator');
  const win = await app.getWindow(20);
  await win.click({ x: 10, y: 20, target: { kind: 'desktop' }, delivery_mode: 'background' });
  assert.deepEqual(calls.at(-1).args.target, { kind: 'window', pid: 10, window_id: 20 });
  assert.equal(calls.at(-1).args.delivery_mode, 'background');
});

test('browser handles refuse unknown tabs and preserve exact tab binding', async () => {
  const { cua, calls } = setup();
  const browser = await cua.getBrowser({ pid: 10, window_id: 20 });
  assert.throws(() => browser.getTab('wrong'), /Unknown tab/);
  const tab = browser.getTab('tab1');
  await tab.getState();
  assert.equal(calls.at(-1).args.snapshot_format, 'semantic_v2');
  await tab.click({ ref: 'p1:2', target_id: 'wrong', tab_id: 'wrong' });
  assert.deepEqual(calls.at(-1).args, { ref: 'p1:2', target_id: 'target1', tab_id: 'tab1' });
});
