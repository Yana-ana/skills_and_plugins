# Architecture

## Goal

Provide the red-box ArkClaw plugin capability in the AgentDataLake architecture: a generic database recall tool.

The current implementation calls the ClawLake dataset item search API:

```text
POST /memory_cp/api/v1/dataItem/search
```

## Layers

1. `src/index.ts`: source entry export, bundled by Rspack into root `index.js`.
2. `src/plugin.ts`: plugin metadata, config parsing, logger setup, HTTP client defaults, tool registration, and gateway registration.
3. `src/tool/query-database/index.ts`: shared query execution plus the single model-facing `query_database` tool. It validates `DataPath` / `Content` / optional `CreatedBy`, calls the backend, and formats `Items`.
4. `src/gateway/*`: host-side testing gateway methods. They avoid relying on whether the model decides to call a tool.
5. `src/request/*`: shared HTTP client and identity socket token provider.
6. `rspack.config.mjs`: emits the OpenClaw 5.4-compatible `index.js` ESM runtime bundle.

## Removed From The Copied Source

- Company business and risk tools.
- Weather, stock, finance history, World Bank, and API key validation tools.
- Knowledge enable flag and token gateway.
- Local flag.json token source.

## Gateway Methods

The gateway methods are intentionally thin wrappers around the same runtime state and query function used by the tool:

```text
agentdatalake-channel-plugin.status.get
agentdatalake-channel-plugin.status.version
agentdatalake-channel-plugin.query_database
```

`agentdatalake-channel-plugin.query_database` accepts the same params as the tool:

```json
{
  "DataPath": "tos://<bucket>/08-clawlake/fts_embed.lance",
  "Content": "检索内容",
  "CreatedBy": "optional-user-filter"
}
```

Backend HTTP errors are returned as a successful gateway response whose payload has `details.status = "http_error"`, matching the tool behavior. Parameter validation errors return a gateway error.

## Request Authentication

`src/request/identity.ts` reads `tipToken` from the OpenClaw identity socket:

```text
IDENTITY_SOCKET or ~/.openclaw/plugins/identity/identity.sock
```

`src/request/index.ts` injects the token only when no explicit Authorization header is present:

```text
Authorization: Bearer <tipToken>
```

The HTTP client also forwards OpenClaw runtime instance id when available:

```text
X-ArkClaw-Instance-Id: <CLAW_INSTANCE_ID>
```

## Backend Contract

`query_database` sends:

```json
{
  "DataPath": "tos://<bucket>/08-clawlake/fts_embed.lance",
  "Content": "检索内容",
  "CreatedBy": "optional-user-filter"
}
```

The tool accepts both direct response shape:

```json
{
  "Items": []
}
```

and the older ClawLake envelope shape:

```json
{
  "ResponseMetadata": {},
  "Result": {
    "Items": []
  }
}
```
