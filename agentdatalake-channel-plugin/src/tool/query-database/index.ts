import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { globalState } from "../../global-state.js";
import {
  HttpStatusError,
  formatApiError,
  http,
  readClawInstanceId,
} from "../../request/index.js";

export const QUERY_DATABASE_PATH = "/memory_cp/api/v1/dataItem/search";
const QUERY_DATABASE_TIMEOUT_MS = 30_000;
const DEFAULT_FTS_COLUMN = "content";
const DEFAULT_VECTOR_COLUMN = "embedding";
const DEFAULT_COLUMNS = ["content", "created_at", "speaker_id"] as const;

type JsonObject = Record<string, unknown>;

export type QueryDatabaseRequest = {
  DataPath: string;
  Query?: string;
  FtsColumn?: string;
  VectorColumn?: string;
  Filter?: string;
  Columns?: string[];
  TopK?: number;
};

type QueryDatabaseDataItem = {
  ColumnName: string;
  ColumnValue: string;
  IsTruncated?: boolean;
  AvDuration?: unknown;
};

type QueryDatabaseItem = {
  DataItems: QueryDatabaseDataItem[];
};

type QueryDatabaseResponse = {
  Items: QueryDatabaseItem[];
};

type BackendResponseError = {
  Message?: string;
  Notice?: string;
};

type BackendResponseMetadata = {
  Error?: BackendResponseError | null;
};

type BackendEnvelope = {
  ResponseMetadata?: BackendResponseMetadata;
  Result?: unknown;
};

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(params: JsonObject, name: keyof QueryDatabaseRequest): string {
  const value = params[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalString(
  params: JsonObject,
  name: keyof QueryDatabaseRequest,
): string | undefined {
  const value = params[name];
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

function optionalColumns(params: JsonObject): string[] {
  const value = params.Columns;
  if (value === undefined) {
    return [...DEFAULT_COLUMNS];
  }
  if (!Array.isArray(value)) {
    throw new Error("Columns must be an array of strings");
  }
  const columns = value.map((column) => {
    if (typeof column !== "string" || !column.trim()) {
      throw new Error("Columns must contain non-empty strings");
    }
    return column.trim();
  });
  if (columns.length === 0) {
    throw new Error("Columns must contain at least one column");
  }
  return columns;
}

function optionalTopK(params: JsonObject): number | undefined {
  const value = params.TopK;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("TopK must be a positive integer");
  }
  return value;
}

function sqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function mergeClawInstanceFilter(
  filter: string | undefined,
  clawInstanceId: string,
): string {
  const userFilter = `claw_id = '${sqlStringLiteral(clawInstanceId)}'`;
  return filter ? `${userFilter} and (${filter})` : userFilter;
}

function compactObject<T extends JsonObject>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

export function buildQueryDatabaseRequest(params: unknown): QueryDatabaseRequest {
  const input = isRecord(params) ? params : {};
  const dataPath = requiredString(input, "DataPath");
  const query = optionalString(input, "Query");
  const filter = optionalString(input, "Filter");
  const columns = optionalColumns(input);
  const topK = optionalTopK(input);
  const clawInstanceId = readClawInstanceId();
  if (!clawInstanceId) {
    throw new Error("CLAW_INSTANCE_ID is required");
  }
  return compactObject({
    DataPath: dataPath,
    Query: query,
    FtsColumn: query
      ? (optionalString(input, "FtsColumn") ?? DEFAULT_FTS_COLUMN)
      : optionalString(input, "FtsColumn"),
    VectorColumn: query
      ? (optionalString(input, "VectorColumn") ?? DEFAULT_VECTOR_COLUMN)
      : optionalString(input, "VectorColumn"),
    Filter: mergeClawInstanceFilter(filter, clawInstanceId),
    Columns: columns,
    TopK: topK,
  });
}

function parseEnvelope(value: unknown): BackendEnvelope | null {
  if (typeof value === "string") {
    try {
      return parseEnvelope(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) {
    return null;
  }
  return {
    ResponseMetadata: isRecord(value.ResponseMetadata)
      ? (value.ResponseMetadata as BackendResponseMetadata)
      : undefined,
    Result: value.Result ?? null,
  };
}

function parseItems(value: unknown): QueryDatabaseResponse {
  const payload = parseEnvelope(value)?.Result ?? value;
  if (!isRecord(payload) || !Array.isArray(payload.Items)) {
    throw new Error("Invalid response: Items is required");
  }
  return {
    Items: payload.Items.map((item) => {
      const row = isRecord(item) ? item : {};
      const dataItems = Array.isArray(row.DataItems)
        ? row.DataItems
        : Array.isArray(row.DatasetDataItem)
          ? row.DatasetDataItem
          : [];
      return {
        DataItems: dataItems.map((dataItem) => {
          const cell = isRecord(dataItem) ? dataItem : {};
          const columnValue = cell.ColumnValue ?? cell.Value;
          return {
            ColumnName:
              typeof cell.ColumnName === "string" ? cell.ColumnName : "",
            ColumnValue: columnValue == null ? "" : String(columnValue),
            ...(typeof cell.IsTruncated === "boolean"
              ? { IsTruncated: cell.IsTruncated }
              : {}),
            ...(Object.hasOwn(cell, "AvDuration")
              ? { AvDuration: cell.AvDuration }
              : {}),
          };
        }),
      };
    }),
  };
}

function toRows(items: QueryDatabaseItem[]): Array<Record<string, string>> {
  return items.map((item) =>
    Object.fromEntries(
      item.DataItems.map((dataItem) => [
        dataItem.ColumnName,
        dataItem.ColumnValue,
      ]).filter(([columnName]) => columnName),
    ),
  );
}

function responseMetadata(value: unknown): BackendResponseMetadata | null {
  return parseEnvelope(value)?.ResponseMetadata ?? null;
}

function toPrettyText(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function describeFailure(error: unknown) {
  if (error instanceof HttpStatusError) {
    const envelope = parseEnvelope(error.body);
    const metadata = envelope?.ResponseMetadata;
    const baseMessage =
      (typeof metadata?.Error?.Message === "string" && metadata.Error.Message.trim()) ||
      formatApiError(error) ||
      `HTTP ${error.status}`;
    const notice =
      typeof metadata?.Error?.Notice === "string" && metadata.Error.Notice.trim()
        ? metadata.Error.Notice.trim()
        : "";
    return {
      status: error.status,
      message: notice ? `${baseMessage} Notice: ${notice}` : baseMessage,
      notice: notice || null,
      responseMetadata: metadata ?? null,
      response: error.body ?? null,
    };
  }
  return {
    status: null,
    message: formatApiError(error) || "query_database request failed",
    notice: null,
    responseMetadata: null,
    response: error ?? null,
  };
}

export async function executeQueryDatabase(params: unknown) {
  const request = buildQueryDatabaseRequest(params);
  globalState.logger?.info?.(
    `[query_database] start endpoint=${QUERY_DATABASE_PATH} request=${toPrettyText(request)}`,
  );

  try {
    const raw = await http.post<unknown>({
      url: QUERY_DATABASE_PATH,
      body: request,
      config: {
        timeoutMs: QUERY_DATABASE_TIMEOUT_MS,
      },
    });
    const response = parseItems(raw);
    const metadata = responseMetadata(raw);
    const count = response.Items.length;
    const rows = toRows(response.Items);

    globalState.logger?.info?.(
      `[query_database] status=success endpoint=${QUERY_DATABASE_PATH} count=${count}`,
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `query_database retrieved ${count} item(s).\n\n${toPrettyText(rows)}`,
        },
      ],
      details: {
        status: "ok",
        endpoint: QUERY_DATABASE_PATH,
        request,
        items: response.Items,
        rows,
        responseMetadata: metadata,
      },
    };
  } catch (error) {
    const failure = describeFailure(error);
    globalState.logger?.warn?.(
      `[query_database] status=http_error endpoint=${QUERY_DATABASE_PATH} code=${failure.status ?? "unknown"} message=${failure.message}`,
    );

    return {
      content: [
        {
          type: "text" as const,
          text:
            `query_database request failed. ` +
            `${failure.status ? `HTTP ${failure.status}. ` : ""}` +
            `Message: ${failure.message}`,
        },
      ],
      details: {
        status: "http_error",
        endpoint: QUERY_DATABASE_PATH,
        request,
        httpStatus: failure.status ?? null,
        message: failure.message,
        notice: failure.notice ?? null,
        responseMetadata: failure.responseMetadata ?? null,
        response: failure.response ?? null,
      },
    };
  }
}

export const registerQueryDatabaseTool = (api: OpenClawPluginApi) => {
  api.registerTool(
    (_ctx) => ({
      name: "query_database",
      label: "Query Database",
      description:
        "Search AgentDataLake / ClawLake dataset items by DataPath, optional Query, Filter, Columns, and TopK.",
      parameters: Type.Object(
        {
          DataPath: Type.String({
            minLength: 1,
            description:
                "Dataset path to query, for example tos://xqfz/lance_data/profile.lance for speaker profiles or tos://xqfz/lance_data/speech.lance for speech content.",
          }),
          Query: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Optional full-text or vector search query. If omitted, the backend does not run search.",
            }),
          ),
          FtsColumn: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Optional full-text search column. Defaults to content when Query is provided.",
            }),
          ),
          VectorColumn: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Optional vector search column. Defaults to embedding when Query is provided.",
            }),
          ),
          Filter: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Optional SQL-like filter condition, for example x = xx. The tool automatically adds the current claw_id scope.",
            }),
          ),
          Columns: Type.Optional(
            Type.Array(
              Type.String({
                minLength: 1,
              }),
              {
                minItems: 1,
                description:
                  "Optional response columns. Defaults to content, created_at, and speaker_id.",
              },
            ),
          ),
          TopK: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Optional maximum number of results. Backend default is 10.",
            }),
          ),
        },
        {
          additionalProperties: false,
        },
      ),
      async execute(_toolCallId, params) {
        return executeQueryDatabase(params);
      },
    }),
    { name: "query_database" },
  );
};
