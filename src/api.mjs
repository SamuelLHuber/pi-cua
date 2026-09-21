export const GUIDE = `pi-cua: persistent JavaScript over Cua Driver
Variables survive cells. Use var for reusable bindings; top-level await works.
Start with await cua.getState(), or var app = await cua.getApp("Calculator").
getApp selects one RUNNING app by exact name, bundle ID, launch path, or PID; it never launches or selects an ambiguous app.
app.getWindows(); await app.getWindow(observedWindowId) -> window handle.
win.getState(options) returns current accessibility data and emits screenshot images.
win.click(args), win.type(args), win.pressKey(args), win.scroll(args) bind the exact window.
Read await cua.describe("click") etc. for your installed driver's parameter names before acting.
await cua.getBrowser({pid, window_id}) binds an existing browser window without enabling debugging.
browser.getTabs(); browser.getTab(observedTabId) -> tab handle.
tab.getState(options), tab.click(args), tab.type(args), tab.navigate(url), tab.pointer(args).
await cua.describe() lists actual driver tools; cua.describe(name) returns the full live schema.
await cua.call(name, args) exposes driver capabilities not covered by convenience methods.
repl.write(value) emits text; repl.emitImage({data, mimeType}) emits an image.
Tool-produced images are emitted automatically, not printed as base64. Last expressions are printed automatically.
Use fresh observations before actions; verify after changes. No automatic mutation retries or foreground fallbacks.
Read tool errors: permission grants and browser setup require explicit user action/authorization.
Reset with cua_repl_reset: variables, handles, and the driver session are discarded.
This REPL is a trusted coding environment, NOT a security sandbox. Cua's launch policy governs driver access.`;

function textOf(result) {
  return (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
}

export function dataOf(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch { /* some tools only return prose */ }
  }
  return undefined;
}

function records(result, key) {
  if (Array.isArray(result.data?.[key])) return result.data[key];
  if (Array.isArray(result.data)) return result.data;
  throw new Error(`Driver did not return structured ${key}. Inspect cua.call() output; this driver version may need an adapter update.`);
}

function safeId(id) {
  // JSON MCP transports cannot preserve integers beyond Number.MAX_SAFE_INTEGER.
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Expected a positive, safely representable observed numeric ID.');
  return id;
}

export function createApi(rpc, emit) {
  async function call(name, args = {}) {
    const result = await rpc('call', { name, args });
    for (const item of result.content ?? []) {
      if (item.type === 'image') emit(item);
    }
    if (result.isError) throw new Error(`${name}: ${textOf(result) || JSON.stringify(result.structuredContent)}`);
    return { data: dataOf(result), text: textOf(result) };
  }
  const describe = name => rpc('describe', { name });

  function windowHandle(pid, windowId) {
    const target = Object.freeze({ pid: safeId(pid), window_id: safeId(windowId) });
    async function action(name, args = {}) {
      const schema = await describe(name);
      const input = { ...args };
      for (const key of ['pid', 'window_id', 'target', 'scope']) delete input[key];
      // Modern click uses ActionTarget; older/native methods use flat pid/window_id.
      const binding = schema.inputSchema?.properties?.target
        ? { target: { kind: 'window', ...target } }
        : target;
      return call(name, { ...input, ...binding });
    }
    return Object.freeze({
      ...target,
      getState: (options = {}) => call('get_window_state', { ...options, ...target }),
      click: args => action('click', args),
      type: args => action('type_text', args),
      pressKey: args => action('press_key', args),
      scroll: args => action('scroll', args),
      getBrowser: () => getBrowser(target),
    });
  }

  async function getApp(selector) {
    const apps = records(await call('list_apps'), 'apps');
    const matches = apps.filter(app => app.pid > 0 && app.running !== false && (
      typeof selector === 'number' ? app.pid === selector :
      [app.name, app.bundle_id, app.launch_path].some(value => typeof value === 'string' && value.toLowerCase() === String(selector).toLowerCase())
    ));
    if (matches.length !== 1) throw new Error(`Expected one running app matching ${JSON.stringify(selector)}, found ${matches.length}. Inspect cua.getState(), use an exact PID, or explicitly launch via cua.call("launch_app", ...).`);
    const info = Object.freeze({ ...matches[0] });
    const getWindows = async () => records(await call('list_windows', { pid: info.pid }), 'windows');
    emit({ type: 'text', text: `${GUIDE}\nSelected app: ${JSON.stringify(info)}\nWindows: ${JSON.stringify(await getWindows())}` });
    return Object.freeze({
      info,
      getWindows,
      getWindow: async id => {
        safeId(id);
        const windows = await getWindows();
        if (!windows.some(win => win.window_id === id && win.pid === info.pid)) throw new Error('That window does not belong to this app. Refresh app.getWindows().');
        return windowHandle(info.pid, id);
      },
    });
  }

  async function getBrowser({ pid, window_id }) {
    const binding = await call('get_browser_state', { pid: safeId(pid), window_id: safeId(window_id) });
    const targetId = binding.data?.target_id;
    const tabs = binding.data?.tabs;
    if (typeof targetId !== 'string' || !Array.isArray(tabs)) throw new Error(`Browser did not return an exact target and tabs. ${binding.text}`);
    emit({ type: 'text', text: `Browser bound: ${JSON.stringify(binding.data)}\nUse browser.getTab(observedTabId), then tab.getState(). Browser setup is never automatic.` });
    function getTab(id) {
      if (!tabs.some(tab => (tab.tab_id ?? tab.id) === id)) throw new Error('Unknown tab ID for this browser binding. Rebind and inspect returned tabs.');
      const scope = Object.freeze({ target_id: targetId, tab_id: id });
      const scoped = (name, args = {}) => call(name, { ...args, ...scope });
      return Object.freeze({
        ...scope,
        getState: (options = {}) => scoped('get_browser_state', { snapshot_format: 'semantic_v2', ...options }),
        click: args => scoped('browser_click', args),
        type: args => scoped('browser_type', args),
        navigate: url => scoped('browser_navigate', { url }),
        pointer: args => scoped('browser_pointer', args),
      });
    }
    return Object.freeze({ target_id: targetId, getTabs: () => structuredClone(tabs), getTab });
  }

  return Object.freeze({
    help: () => GUIDE,
    describe,
    call,
    getApp,
    getBrowser,
    getState: async () => ({
      apps: records(await call('list_apps'), 'apps'),
      windows: records(await call('list_windows'), 'windows'),
    }),
  });
}
