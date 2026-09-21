# Validation — 2026-09-21

Environment: macOS, Node.js 22.23.2, Pi 0.84.3, Cua Driver 0.28.2.

- All 16 automated worker, API, MCP transport, and Pi adapter tests pass. They cover persistent bindings, top-level await, syntax/runtime errors, timeout, cancellation, queued-cell invalidation, idle-worker cleanup, output limits, image blocks, exact target binding, browser tab binding, session ownership, launch environment, and reset.
- Real `pi -p` smoke: six tool calls; a variable initialized to 40 produces 42 in a second cell; an intentional failure is reported as a failed Pi tool call; the next cell still produces 42; reset removes the binding, verified by `typeof` returning `undefined`.
- Installed-package `pi -p` smoke: Pi discovers the extension, reads its help, connects to Cua Driver, and retrieves the actual `click` schema.
- Cua Driver advertises 56 tools through the MCP connection.
- The bundled skill passes the skill validator. Package contents pass `npm pack --dry-run`; production dependency audit reports zero known vulnerabilities.

## Remaining native verification

Live desktop discovery returns `permissions_pending` because CuaDriver still needs macOS Accessibility and Screen Recording approval. No desktop-action success is claimed. Native app actions, real screenshots, browser attachment, and platform-specific delivery still require live testing after the user grants those permissions.

After granting access, run `npm run doctor` and use Pi to launch Calculator, perform a harmless calculation, and verify the result from fresh state. Browser testing should use an explicitly authorized isolated profile and a disposable page.

No automation of macOS permission dialogs, unrestricted driver mode, or authenticated browser attachment was used.
