import { test } from 'node:test';
import assert from 'node:assert/strict';
import extension from '../src/index.mjs';

test('Pi tools throw on cell failure and preserve the runtime for a subsequent call', async t => {
  const tools = new Map();
  const hooks = new Map();
  extension({ registerTool: tool => tools.set(tool.name, tool), on: (name, handler) => hooks.set(name, handler), registerCommand() {} });
  t.after(() => hooks.get('session_shutdown')());
  const repl = tools.get('cua_repl');
  await repl.execute('1', { code: 'var value = 42' });
  await assert.rejects(repl.execute('2', { code: 'throw new Error("expected failure")' }), /expected failure/);
  const result = await repl.execute('3', { code: 'value' });
  assert.equal(result.content[0].text, '42');
  await tools.get('cua_repl_reset').execute();
  assert.equal((await repl.execute('4', { code: 'typeof value' })).content[0].text, 'undefined');
});
