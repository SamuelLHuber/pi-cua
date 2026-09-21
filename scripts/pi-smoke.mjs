import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const extension = fileURLToPath(new URL('../src/index.mjs', import.meta.url));
const prompt = 'Test cua_repl with exactly six separate tool calls. 1: var piCuaCheck = await Promise.resolve(40). 2: piCuaCheck + 2. 3: throw new Error("intentional-smoke-error"). This failure is expected; continue testing. 4: piCuaCheck + 2 again to verify state survives. 5: cua_repl_reset. 6: typeof piCuaCheck. Do not access desktop apps. Report actual results.';
const child = spawn('pi', ['--no-extensions', '-e', extension, '--no-builtin-tools', '--no-skills', '--no-prompt-templates', '--no-session', '--mode', 'json', '-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
try {
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  assert.equal(code, 0, `Pi exited ${code}: ${stderr}`);
  const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const calls = events.filter(event => event.type === 'tool_execution_end');
  const failures = calls.filter(call => call.isError);
  assert.equal(failures.length, 1, 'Expected exactly one deliberate Pi tool failure.');
  assert.ok(JSON.stringify(failures[0].result).includes('intentional-smoke-error'), 'Pi did not propagate the expected failure.');
  const reset = calls.findIndex(call => call.toolName === 'cua_repl_reset');
  const texts = call => (call.result?.content ?? []).filter(block => block.type === 'text').map(block => block.text);
  assert.ok(reset > 0, 'Pi did not reset the REPL.');
  assert.equal(calls.slice(0, reset).filter(call => texts(call).includes('42')).length, 2, 'State did not survive across cells and the intentional error.');
  assert.ok(calls.slice(reset + 1).some(call => texts(call).includes('undefined')), 'Reset did not clear state.');
  console.log(`PASS: Pi completed ${calls.length} tool calls; 42 before and after expected failure, then undefined after reset.`);
} finally { clearTimeout(timer); }
