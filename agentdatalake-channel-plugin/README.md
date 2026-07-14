## agentdatalake-channel-plugin

OpenClaw plugin for the AgentDataLake channel. It exposes the ArkClaw red-box
capability: one generic database recall tool backed by ClawLake.

The plugin exposes a single model-facing tool:

- `query_database`: calls `POST /memory_cp/api/v1/dataItem/search` with `DataPath`, optional `Query`, `FtsColumn`, `VectorColumn`, `Filter`, `Columns`, and `TopK`.

For deterministic host-side testing, the plugin also registers three gateway methods:

- `agentdatalake-channel-plugin.status.get`: returns runtime base URL, backend path, and tool name.
- `agentdatalake-channel-plugin.status.version`: returns the bundled plugin version.
- `agentdatalake-channel-plugin.query_database`: calls the same query implementation as the tool, with the same parameters.

HTTP requests under `src/request` use the OpenClaw identity socket token and send it as `Authorization: Bearer <tipToken>`.
The runtime entry is the Rspack-built root `index.js`, matching the OpenClaw 5.4 plugin loading shape.

Build-time backend environments:

- `prod`: `http://sd80qehkc19oii7djnm20.apigateway-cn-beijing.volceapi.com`
- `DataPath`: `tos://<bucket>/08-clawlake/fts_embed.lance`

Release artifacts are uploaded by environment only:

```text
agentdatalake-channel-plugin_<prod>/launcher.sh
```

### Quick Start

```bash
npm install
npm run typecheck
CUSTOM_TYPE=prod npm run build
npm test
```

### Structure

- `src/plugin.ts`: plugin metadata and registration.
- `src/tool/query-database/`: the only tool implementation.
- `src/gateway/`: deterministic host-side gateway methods for status and query testing.
- `src/request/`: shared HTTP client and identity socket token provider.
- `rspack.config.mjs`: builds the OpenClaw runtime entry `index.js`.
- `docs/architecture.md`: current architecture notes.

### Development Notes

- `bytedance-knowledge-myz` is a symlink to `/Users/bytedance/Desktop/myz-bytedance/bytedance-knowledge-myz`, not a copied documentation tree. When updating requirement docs through this repo, edit it as the KB target repo and do not try to keep a second local copy in sync.
