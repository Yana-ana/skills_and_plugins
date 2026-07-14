# Tests

Unit tests live next to the source files under `src/**/*.test.ts`.

Run:

```bash
npm run typecheck
npm run build
npm test
```

Gateway smoke targets:

- `agentdatalake-channel-plugin.status.get`
- `agentdatalake-channel-plugin.status.version`
- `agentdatalake-channel-plugin.query_database`

The query gateway uses the same params as the tool. See `examples/gateway-query.input.json`.
