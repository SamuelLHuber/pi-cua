import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Driver, driverArguments, driverEnvironment } from '../src/driver.mjs';

test('MCP stdio handshake, lazy session, owned session injection and lifecycle guards', async t => {
  const driver = new Driver({ command: process.execPath, args: [fileURLToPath(new URL('./fixture-server.mjs', import.meta.url))], env: { CUA_DRIVER_PERMISSION_MODE: 'bounded' } });
  t.after(() => driver.close());
  assert.equal((await driver.describe()).length, 4);
  assert.equal(driver.started, undefined);
  const first = await driver.call('echo', { value: 42 });
  assert.equal(first.structuredContent.events[0].name, 'start_session');
  assert.equal(first.structuredContent.events[1].arguments.session, driver.session);
  assert.equal(first.structuredContent.env.permissionMode, 'bounded');
  const second = await driver.call('without_session');
  assert.equal('session' in second.structuredContent.events.at(-1).arguments, false);
  await assert.rejects(driver.call('echo', { session: 'someone-else' }), /another driver session/);
  await assert.rejects(driver.call('end_session'), /lifecycle belongs/);
  await assert.rejects(driver.call('unknown'), /does not expose/);
  await driver.close();
  await assert.rejects(driver.call('echo'), /closed/);
});

test('trusted launch arguments are parsed without shell expansion and Cua policy is inherited', () => {
  assert.deepEqual(driverArguments({ PI_CUA_DRIVER_ARGS: '["mcp","--socket","/path with spaces"]' }), ['mcp', '--socket', '/path with spaces']);
  assert.throws(() => driverArguments({ PI_CUA_DRIVER_ARGS: '"mcp"' }), /JSON array/);
  assert.deepEqual(driverEnvironment({ CUA_DRIVER_PERMISSION_MODE: 'bounded', DISPLAY: ':0', OPENAI_API_KEY: 'secret' }), { CUA_DRIVER_PERMISSION_MODE: 'bounded', DISPLAY: ':0' });
});
