# Changelog

## 0.2.0 — 2026-10-03

- Target Pi 1.0.0; execute persistent REPL and reset sequentially.
- Use tool prompt guidelines without replacing the host system prompt.
- Return failures as Pi tool results with `isError`, retaining runtime state for diagnosis.
- Verified: 17 tests, including actual Pi codemode state/error/reset integration; JavaScript syntax checks; and a read-only Cua Driver doctor (56 MCP tools; 106 app entries).
- OS permission prompts, foreground delivery, browser mutations, and live UI writes are not exercised.
- Public release repository: https://github.com/SamuelLHuber/pi-cua. Package archives are provided through GitHub releases; npm registry publication is separate.
