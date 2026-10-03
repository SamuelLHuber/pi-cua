import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, createCodemodeExtension } from '@earendil-works/pi-coding-agent';

test('actual Pi 1 codemode preserves Cua state, propagates errors and resets without desktop access', { timeout: 30000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-cua-host-'));
  const settingsManager = SettingsManager.inMemory({ defaultTools: ['codemode', 'cua_repl', 'cua_repl_reset'] });
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true, noContextFiles: true,
    additionalExtensionPaths: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
    extensionFactories: [{ name: 'codemode', factory: createCodemodeExtension() }] });
  await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({ cwd, agentDir: cwd, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
  const tool = session.agent.state.tools.find(t => t.name === 'codemode');
  assert.deepEqual(extensionsResult.errors, []);
  assert.ok(tool);
  session.sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'toolCall', id: 'fixture', name: 'codemode', arguments: {} }], api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: Date.now(), stopReason: 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  session.refreshContext();
  const cell = code => tool.execute('fixture', { code: `return await tools.cua_repl(${JSON.stringify({ code })});` });
  const reset = () => tool.execute('fixture', { code: 'return await tools.cua_repl_reset({});' });
  try {
    assert.notEqual((await cell('var piCuaHostCheck = await Promise.resolve(40)')).isError, true);
    assert.match(JSON.stringify(await cell('piCuaHostCheck + 2')), /42/);
    const failed = await cell('throw new Error("intentional-host-error")');
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed), /intentional-host-error/);
    assert.match(JSON.stringify(await cell('piCuaHostCheck + 2')), /42/);
    assert.notEqual((await reset()).isError, true);
    assert.match(JSON.stringify(await cell('typeof piCuaHostCheck')), /undefined/);
  } finally {
    await reset();
    session.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
});
