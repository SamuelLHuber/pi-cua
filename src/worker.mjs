import nodeRepl from 'node:repl';
import { PassThrough } from 'node:stream';
import { inspect } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createApi } from './api.mjs';

const context = new AsyncLocalStorage();
const requests = new Map();
let nextRequest = 0;
const send = message => { if (process.connected) process.send(message); };
const format = value => typeof value === 'string' ? value : inspect(value, { depth: 7, maxArrayLength: 150, maxStringLength: 16000, colors: false, customInspect: false, getters: false });

function emit(block) {
  const cell = context.getStore();
  if (!cell || cell.finished) return;
  send({ type: 'output', cell: cell.id, block });
}

function rpc(method, params) {
  const cell = context.getStore();
  if (!cell || cell.finished) return Promise.reject(new Error('No active REPL cell; delayed actions are not allowed.'));
  const id = ++nextRequest;
  const promise = new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    send({ type: 'rpc', id, cell: cell.id, method, params });
  });
  // Track calls even when the cell forgets to await them. Do not let them escape its lifetime.
  cell.calls.push(promise);
  promise.catch(() => {});
  return promise;
}

const output = new PassThrough();
output.on('data', chunk => emit({ type: 'text', text: chunk.toString() }));
const server = nodeRepl.start({ input: new PassThrough(), output, terminal: false, prompt: '', useGlobal: false, ignoreUndefined: true });
// Node's default REPL evaluator sends runtime errors to its domain instead of
// its callback. Bridge that path too, otherwise a thrown error hangs the cell.
let rejectEvaluation;
server._domain.removeAllListeners('error');
server._domain.on('error', error => rejectEvaluation?.(error));
const write = value => emit({ type: 'text', text: format(value) });
const emitImage = image => {
  if (!image || typeof image.data !== 'string' || !/^image\//.test(image.mimeType)) throw new Error('emitImage expects {data: base64String, mimeType: "image/png"}.');
  emit({ type: 'image', data: image.data, mimeType: image.mimeType });
};
Object.assign(server.context, {
  cua: createApi(rpc, emit),
  repl: Object.freeze({ write, emitImage }),
  console: Object.freeze({ log: (...args) => write(args.map(format).join(' ')), info: (...args) => write(args.map(format).join(' ')), warn: (...args) => write(args.map(format).join(' ')), error: (...args) => write(args.map(format).join(' ')) }),
});

process.on('message', message => {
  if (message.type === 'rpc-result') {
    const pending = requests.get(message.id);
    if (!pending) return;
    requests.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
    return;
  }
  if (message.type !== 'eval') return;
  const cell = { id: message.id, calls: [], finished: false };
  context.run(cell, async () => {
    try {
      const value = await new Promise((resolve, reject) => {
        rejectEvaluation = reject;
        server.eval(message.code + '\n', server.context, `pi-cua-cell-${message.id}.js`, (error, value) => error ? reject(error.err ?? error) : resolve(value));
      });
      for (let index = 0; index < cell.calls.length; index++) await Promise.allSettled([cell.calls[index]]);
      if (value !== undefined) write(value);
      cell.finished = true;
      send({ type: 'done', cell: cell.id });
    } catch (error) {
      for (let index = 0; index < cell.calls.length; index++) await Promise.allSettled([cell.calls[index]]);
      cell.finished = true;
      send({ type: 'done', cell: cell.id, error: `${error.name ?? 'Error'}: ${error.message ?? error}` });
    } finally {
      rejectEvaluation = undefined;
    }
  });
});

process.on('disconnect', () => process.exit(0));
send({ type: 'ready' });
