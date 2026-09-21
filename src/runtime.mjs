import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Driver } from './driver.mjs';

export class ReplRuntime {
  constructor({ driverFactory = () => new Driver(), maxTextBytes = 32000, maxImageBytes = 12 * 1024 * 1024, maxImages = 4 } = {}) {
    this.driverFactory = driverFactory;
    this.limits = { maxTextBytes, maxImageBytes, maxImages };
    this.sequence = 0;
    this.generation = 0;
    this.queue = Promise.resolve();
  }

  evaluate(code, { timeoutMs = 60000, signal } = {}) {
    if (typeof code !== 'string' || code.length > 100000) return Promise.reject(new Error('Code must be a string of at most 100,000 characters.'));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return Promise.reject(new Error('timeoutMs must be an integer between 1 and 120000.'));
    const generation = this.generation;
    const run = this.queue.then(() => generation === this.generation
      ? this.run(code, { timeoutMs, signal })
      : { content: [{ type: 'text', text: 'Queued cell cancelled by REPL reset.' }], isError: true });
    this.queue = run.catch(() => {});
    return run;
  }

  start() {
    if (this.worker) return;
    this.driver = this.driverFactory();
    const worker = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: ['--max-old-space-size=256'],
      serialization: 'advanced',
    });
    this.worker = worker;
    worker.on('message', message => this.message(worker, message));
    const log = chunk => {
      if (this.active?.worker === worker) this.output({ type: 'text', text: chunk.toString() });
    };
    worker.stdout.on('data', log);
    worker.stderr.on('data', log);
    worker.on('error', error => {
      if (this.active?.worker === worker) this.active.finish(`REPL worker failed: ${error.message}`, true);
    });
    worker.on('exit', (code, signal) => {
      if (this.active?.worker === worker) this.active.finish(`REPL worker exited (${signal ?? code}); reset before continuing.`, true);
      // An idle worker can exit from a delayed callback. Release its driver
      // instead of losing that connection when the next cell starts a worker.
      else if (this.worker === worker) void this.dispose();
    });
  }

  async run(code, { timeoutMs, signal }) {
    if (signal?.aborted) return { content: [{ type: 'text', text: 'Cell cancelled before execution.' }], isError: true };
    this.start();
    return new Promise(resolve => {
      const active = {
        id: ++this.sequence, worker: this.worker, driver: this.driver,
        content: [], textBytes: 0, imageBytes: 0, images: 0, truncated: false,
        controller: new AbortController(),
        rpcQueue: Promise.resolve(),
      };
      const finish = async (error, invalidate = false) => {
        if (this.active !== active) return;
        this.active = undefined;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        active.controller.abort();
        if (error) active.content.push({ type: 'text', text: error });
        if (invalidate) {
          await this.dispose();
          active.content.push({ type: 'text', text: 'REPL reset: variables and handles discarded. An already-dispatched desktop action may have completed; inspect state before retrying.' });
        }
        if (active.truncated) active.content.push({ type: 'text', text: '[Output truncated. Query a smaller scope or emit fewer images.]' });
        if (!active.content.length) active.content.push({ type: 'text', text: 'Cell completed.' });
        resolve({ content: active.content, isError: Boolean(error) });
      };
      active.finish = finish;
      const abort = () => finish('Cell cancelled.', true);
      const timer = setTimeout(() => finish(`Cell timed out after ${timeoutMs} ms.`, true), timeoutMs);
      this.active = active;
      signal?.addEventListener('abort', abort, { once: true });
      active.worker.send({ type: 'eval', id: active.id, code });
    });
  }

  output(block) {
    const active = this.active;
    if (!active) return;
    if (block.type === 'image') {
      const bytes = Buffer.byteLength(block.data ?? '', 'base64');
      if (active.images >= this.limits.maxImages || active.imageBytes + bytes > this.limits.maxImageBytes) {
        active.truncated = true;
        return;
      }
      active.images++;
      active.imageBytes += bytes;
      active.content.push({ type: 'image', data: block.data, mimeType: block.mimeType });
    } else if (block.type === 'text' && typeof block.text === 'string') {
      const remaining = this.limits.maxTextBytes - active.textBytes;
      const bytes = Buffer.from(block.text);
      if (bytes.length > remaining) active.truncated = true;
      if (remaining > 0) {
        active.content.push({ type: 'text', text: bytes.subarray(0, remaining).toString('utf8') });
        active.textBytes += Math.min(bytes.length, remaining);
      }
    }
  }

  async message(worker, message) {
    const active = this.active;
    if (!active || active.worker !== worker || message.cell !== active.id) {
      if (message.type === 'rpc' && worker.connected) worker.send({ type: 'rpc-result', id: message.id, error: 'Cell is no longer active; action refused.' });
      return;
    }
    if (message.type === 'output') this.output(message.block);
    if (message.type === 'done') await active.finish(message.error);
    if (message.type === 'rpc') {
      const previous = active.rpcQueue;
      let release;
      active.rpcQueue = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        if (this.active !== active) return;
        let value;
        if (message.method === 'describe') value = await active.driver.describe(message.params.name);
        else if (message.method === 'call') value = await active.driver.call(message.params.name, message.params.args, active.controller.signal);
        else throw new Error('Unknown broker method.');
        if (this.active === active && worker.connected) worker.send({ type: 'rpc-result', id: message.id, value });
      } catch (error) {
        if (this.active === active && worker.connected) worker.send({ type: 'rpc-result', id: message.id, error: error.message });
      } finally {
        release();
      }
    }
  }

  async dispose() {
    this.generation++;
    const worker = this.worker;
    const driver = this.driver;
    this.worker = undefined;
    this.driver = undefined;
    if (worker) worker.kill('SIGKILL');
    if (driver) {
      let timer;
      await Promise.race([
        driver.close().catch(() => {}),
        new Promise(resolve => { timer = setTimeout(resolve, 4000); }),
      ]);
      clearTimeout(timer);
    }
  }

  async reset() {
    this.generation++;
    if (this.active) await this.active.finish('REPL reset requested.', true);
    await this.queue;
    await this.dispose();
  }
}
