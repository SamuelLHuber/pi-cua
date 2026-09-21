import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

export function driverCommand(env = process.env) {
  if (env.PI_CUA_DRIVER) return env.PI_CUA_DRIVER;
  const local = join(homedir(), '.local/bin/cua-driver');
  return existsSync(local) ? local : 'cua-driver';
}

export function driverArguments(env = process.env) {
  if (!env.PI_CUA_DRIVER_ARGS) return ['mcp'];
  const args = JSON.parse(env.PI_CUA_DRIVER_ARGS);
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new Error('PI_CUA_DRIVER_ARGS must be a JSON array of strings.');
  }
  return args;
}

export function driverEnvironment(env = process.env) {
  // Preserve Cua's trusted launch configuration and Linux display connection,
  // without copying unrelated model/provider secrets into the MCP process.
  const displayKeys = new Set(['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY']);
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => typeof value === 'string' && (key.startsWith('CUA_') || displayKeys.has(key))));
}

export class Driver {
  constructor(options = {}) {
    this.options = options;
    this.session = `pi-cua-${randomUUID()}`;
    this.tools = new Map();
    this.closed = false;
  }

  async connect() {
    if (this.closed) throw new Error('Driver connection is closed; reset the REPL.');
    if (!this.connection) this.connection = this.open();
    return this.connection;
  }

  async open() {
    const ajv = new Ajv({ strict: false, formats: { uint32: true, uint64: true, int32: true, int64: true, double: true, float: true } });
    this.client = new Client({ name: 'pi-cua', version: '0.1.0' }, { jsonSchemaValidator: new AjvJsonSchemaValidator(ajv) });
    this.transport = new StdioClientTransport({
      command: this.options.command ?? driverCommand(),
      args: this.options.args ?? driverArguments(),
      env: { ...driverEnvironment(), ...this.options.env },
      stderr: 'pipe',
    });
    let diagnostic = '';
    this.transport.stderr?.on('data', chunk => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4000);
    });
    try {
      await this.client.connect(this.transport, { timeout: 20000 });
      let cursor;
      do {
        const page = await this.client.listTools({ cursor });
        for (const tool of page.tools) this.tools.set(tool.name, tool);
        cursor = page.nextCursor;
      } while (cursor);
    } catch (error) {
      await this.client.close().catch(() => {});
      throw new Error(`Cannot connect to Cua Driver: ${error.message}${diagnostic ? `\n${diagnostic}` : ''}\nInstall Cua Driver, run cua-driver doctor, and grant its macOS permissions if requested.`, { cause: error });
    }
  }

  async describe(name) {
    await this.connect();
    if (name) {
      const tool = this.tools.get(name);
      if (!tool) throw new Error(`Cua Driver does not expose ${name}.`);
      return tool;
    }
    return [...this.tools.values()].map(({ name, description }) => ({ name, description }));
  }

  async call(name, args = {}, signal) {
    await this.connect();
    if (this.closed || signal?.aborted) throw new Error('Cell cancelled; no more driver actions admitted.');
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Cua Driver does not expose ${name}; use cua.describe().`);
    if (name === 'start_session' || name === 'end_session') {
      throw new Error('Session lifecycle belongs to the REPL. Use cua_repl_reset instead.');
    }
    if (!this.started && this.tools.has('start_session')) {
      const result = await this.client.callTool({ name: 'start_session', arguments: { session: this.session } }, undefined, { signal, timeout: 20000 });
      if (result.isError) throw new Error(resultText(result));
      this.started = true;
    }
    if (this.closed || signal?.aborted) throw new Error('Cell cancelled; no more driver actions admitted.');
    const input = { ...args };
    if ('session' in input && input.session !== this.session) throw new Error('Cannot select another driver session.');
    if (tool.inputSchema?.properties?.session) input.session = this.session;
    const result = await this.client.callTool({ name, arguments: input }, undefined, {
      signal, timeout: 120000,
    });
    return result;
  }

  async close() {
    this.closed = true;
    if (!this.client) return;
    // Do not start a connection just to close it. A bounded wait prevents shutdown hanging.
    try {
      if (this.connection) await this.connection;
      if (this.started && this.tools.has('end_session')) {
        await this.client.callTool({ name: 'end_session', arguments: { session: this.session } }, undefined, { timeout: 3000 });
      }
    } catch { /* closing a failed or disconnected session is best effort */ }
    await this.client.close().catch(() => {});
  }
}

export function resultText(result) {
  return (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
}
