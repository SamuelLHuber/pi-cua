import { Driver, driverCommand, driverArguments } from '../src/driver.mjs';

console.log(`Driver: ${driverCommand()} ${driverArguments().join(' ')}`);
const driver = new Driver();
try {
  const tools = await driver.describe();
  console.log(`MCP connected: ${tools.length} tools discovered.`);
  const result = await driver.call('list_apps');
  if (result.isError) throw new Error(result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n'));
  const count = result.structuredContent?.apps?.length;
  console.log(`Desktop discovery works${count === undefined ? '' : `: ${count} apps`}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await driver.close();
}
