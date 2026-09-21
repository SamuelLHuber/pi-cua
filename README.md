# pi-cua

A persistent JavaScript computer-use REPL for [Pi](https://github.com/badlogic/pi-mono), built directly on [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver).

Pi reasons about the task. A session-owned Node REPL retains variables and app/window/tab handles. A broker calls Cua Driver over MCP. Cua handles accessibility, screenshots, input delivery, browser binding, and driver authorization. No Python bridge, separate computer-use model, or nested agent loop is required.

## Install

Requires Node.js 22+, Pi, and Cua Driver. Development targets Pi 0.84.3 and Cua Driver 0.28.2 on macOS; other platforms use the same MCP boundary but need native verification.

Install Cua Driver using its [official instructions](https://cua.ai/docs/cua-driver). On macOS, grant **CuaDriver** Accessibility and Screen Recording access yourself:

```sh
cua-driver permissions grant
```

Install from your checkout:

```sh
cd ~/git/pi-cua
npm ci
pi install ~/git/pi-cua
```

For development without changing installed packages: `pi -e ./src/index.mjs`. Restart Pi or reload after changing code.

```sh
pi -p "Use cua_repl to list running apps. Do not change anything."
```

## Tools and API

| Tool | Purpose |
| --- | --- |
| `cua_repl` | Evaluate JavaScript with persistent bindings and top-level await |
| `cua_repl_reset` | Discard bindings and close the worker's driver session |

`/cua` shows help; `/cua reset` resets the session. Begin with `cua.help()`. Last expressions print automatically. `repl.write(value)` emits selected data. Screenshots appear inline, not as base64 text.

```js
// Cell 1
var answer = await Promise.resolve(40);
// Cell 2
answer + 2;
// Cell 3
var desktop = await cua.getState();
repl.write(desktop);
```

App selection accepts an exact name, bundle ID, launch path, or numeric PID. It selects one running app and returns documentation plus a window inventory. It never launches an app or picks the first ambiguous match.

```js
var app = await cua.getApp("Calculator");
// Use actual IDs from the returned inventory, not these placeholder names.
var win = await app.getWindow(observedWindowId);
var state = await win.getState();
repl.write(state.data);
```

Read live schemas before acting:

```js
await cua.describe("click");
await win.click({ element_token: observedElementToken, delivery_mode: "background" });
await win.getState(); // verify; this replaces the previous snapshot
```

Window methods: `getState(options)`, `click(args)`, `type(args)`, `pressKey(args)`, `scroll(args)`, `getBrowser()`. Argument names come from Cua's schemas (`type_text`, `press_key`, etc.). The wrapper binds its exact window, rather than defaulting to the active app. It does not automatically switch delivery modes.

Browser inspection requires a browser already available to Cua:

```js
var browser = await cua.getBrowser({ pid: observedPid, window_id: observedWindowId });
browser.getTabs();
var tab = browser.getTab(observedTabId);
await tab.getState(); // semantic_v2
await cua.describe("browser_click");
await tab.click({ ref: observedRef });
await tab.getState();
```

Tab methods: `getState(options)`, `click(args)`, `type(args)`, `navigate(url)`, `pointer(args)`. Tab lists come from the binding snapshot; rebind to refresh. Browser preparation is explicit via `cua.call("browser_prepare", args)` after inspecting its schema and obtaining appropriate authorization. Inspection never enables debugging or attaches to authenticated profiles automatically.

For other capabilities:

```js
await cua.describe();
await cua.describe("launch_app");
await cua.call("launch_app", { bundle_id: "com.apple.calculator" });
```

Calls return `{data, text}`: structured content and the driver's explanation. Images emit separately. `repl.emitImage({data, mimeType})` emits an explicitly supplied base64 image.

## Configuration and permissions

There is no project-local policy file. Configuration comes from the trusted launch environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_CUA_DRIVER` | `~/.local/bin/cua-driver` if present, otherwise PATH | Executable |
| `PI_CUA_DRIVER_ARGS` | `["mcp"]` | JSON argument array; no shell expansion |

`CUA_*` and Linux display variables are forwarded. Unrelated provider keys are not copied into the MCP subprocess. The REPL itself runs with Pi's environment and user privileges.

Cua's permission mode belongs to the runtime-owning process. On macOS, MCP normally proxies through **CuaDriver.app**, retaining its OS identity. Configure that daemon's policy before starting it; a proxy cannot reconfigure an existing daemon. See Cua's [permission modes](https://cua.ai/docs/reference/cua-driver/permission-modes) for bounded manifests and authenticated-profile grants.

**The REPL is a trusted coding environment, not a security sandbox.** The separate worker provides cancellation and fault isolation; Node's REPL context does not prevent filesystem, process, or network access. Cua's policy constrains driver calls, not arbitrary Node code. This extension does not implement Codex-style per-app approval UI.

## Lifecycle and limits

- One worker and lazy MCP connection per session; cells and driver calls serialize.
- Ordinary JavaScript errors preserve variables. Reset/shutdown discards them.
- Default timeout: 60 seconds; per-call maximum: 120 seconds.
- Timeout/cancellation kills the worker and closes its driver session. Already-dispatched actions may complete; reset cannot undo them.
- No automatic mutation retries. Reset after transport failure, then rediscover handles.
- Await operations. Delayed callbacks from completed cells cannot submit broker actions.
- Per-cell output: 32 KB text, four images, 12 MB decoded image bytes. Truncation is explicit.
- Numeric IDs must be safe JavaScript integers; unsupported larger IDs are rejected.
- Node's REPL handles persistent lexical bindings and top-level await. Its domain error bridge is tested; validate new Node major versions before deployment.

## Verification

```sh
npm test          # worker/API tests and real MCP stdio against a fixture
npm run check    # syntax checks
npm run doctor   # installed driver and read-only desktop discovery
npm run test:pi  # real Pi prompt; asserts persistence and reset from tool results
```

`test:pi` uses your configured Pi provider and its normal model usage. It disables other extensions and built-in tools and does not access the desktop.

`doctor` discovers schemas without desktop permissions; its final check requires them. `permissions_pending` means the connection works but macOS approval is incomplete. Approve OS dialogs manually.

This extension does not provision VMs. Cua Driver is its direct backend. An explicitly configured driver endpoint may supply another desktop; never assume the local shell executes there.
