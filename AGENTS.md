# pi-cua

Pi extension with a persistent Node JavaScript REPL over Cua Driver MCP.
Run `npm test` and `npm run check` after implementation changes.
Use the real driver for read-only smoke tests; never automate OS permission dialogs.
Keep driver permissions in the trusted launch environment. Never infer an action target from array order.
The REPL is a trusted coding environment, not a security sandbox. Document that boundary honestly.
Do not silently retry mutations, change input-delivery modes, or reconnect stale handles.
