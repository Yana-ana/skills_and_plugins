import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { retryAsync } from "./retry.js";
import { getTipToken } from "./identity.js";
import { globalState } from "../global-state.js";
import type {
  HttpClient,
  HttpClientDefaults,
  HttpRequestConfig,
  HttpRequestParams,
} from "./types.js";

export type {
  HttpClient,
  HttpClientDefaults,
  HttpRequestConfig,
  HttpRequestParams,
} from "./types.js";

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function debugLogRequest(
  kind: "info" | "error",
  message: string,
  payload?: unknown,
): void {
  if (!globalState.debug) {
    return;
  }
  const logger = globalState.logger;
  const text = payload === undefined ? message : `${message} ${safeSerialize(payload)}`;
  if (kind === "error") {
    logger?.error?.(text);
    return;
  }
  logger?.info?.(text);
}

function redactHeaderValue(name: string, value: string): string {
  const normalized = name.toLowerCase();
  if (
    normalized === "authorization" ||
    normalized === "proxy-authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie"
  ) {
    const scheme = value.trim().split(/\s+/, 1)[0];
    return scheme ? `${scheme} <redacted>` : "<redacted>";
  }
  return value;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      redactHeaderValue(name, value),
    ]),
  );
}

function parseEnvFileClawInstanceId(content: string): string {
  const line = content
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("CLAW_INSTANCE_ID="));
  if (!line) {
    return "";
  }
  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

// OpenClaw exposes the runtime instance id through either the process env or
// ~/.openclaw/.env. Read lazily so tests can stub env values per case.
export function readClawInstanceId(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const value = env ? env["CLAW_INSTANCE_ID"] : undefined;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  const home = env?.HOME?.trim() || os.homedir();
  if (!home) {
    return "";
  }
  try {
    return parseEnvFileClawInstanceId(
      fs.readFileSync(path.join(home, ".openclaw", ".env"), "utf8"),
    );
  } catch {
    return "";
  }
}

export class HttpStatusError extends Error {
  status: number;
  body: unknown;
  url?: string;

  constructor(status: number, body: unknown, url?: string) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

async function readErrorBody(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      // fall through
    }
  }
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function readJsonBody(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType && !contentType.includes("application/json")) {
    throw new Error(`Expected JSON response but got "${contentType}"`);
  }
  return (await res.json()) as unknown;
}

function appendQueryParams(url: URL, query: Record<string, unknown>) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        url.searchParams.append(key, typeof item === "string" ? item : JSON.stringify(item));
      }
      continue;
    }
    if (typeof value === "string") {
      url.searchParams.append(key, value);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      url.searchParams.append(key, String(value));
      continue;
    }
    url.searchParams.append(key, JSON.stringify(value));
  }
}

function resolveUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const trimmedUrl = url.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedUrl}`;
}

async function fetchWithTimeout(params: {
  url: string;
  init: RequestInit;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();

  let clearExternalAbortListener: (() => void) | undefined;
  if (params.signal) {
    if (params.signal.aborted) {
      abort();
    } else {
      params.signal.addEventListener("abort", abort, { once: true });
      clearExternalAbortListener = () => params.signal?.removeEventListener("abort", abort);
    }
  }

  let abortTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let hardTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutMs = Math.max(0, Math.round(params.timeoutMs));
    abortTimeoutId = setTimeout(() => abort(), timeoutMs);
    const hardTimeout = new Promise<never>((_, reject) => {
      hardTimeoutId = setTimeout(() => {
        reject(new Error(`timed out after ${timeoutMs}ms`));
      }, timeoutMs + 50);
    });

    const res = (await Promise.race([
      fetch(params.url, {
        ...params.init,
        signal: controller.signal,
      }),
      hardTimeout,
    ])) as Response;

    return res;
  } finally {
    clearExternalAbortListener?.();
    if (abortTimeoutId !== undefined) clearTimeout(abortTimeoutId);
    if (hardTimeoutId !== undefined) clearTimeout(hardTimeoutId);
  }
}

export function formatApiError(error: unknown) {
  if (!error) {
    return "";
  }
  if (error instanceof HttpStatusError) {
    if (!error.body) {
      return `HTTP ${error.status}`;
    }
    if (typeof error.body === "string") {
      return `HTTP ${error.status} ${error.body}`;
    }
    if (typeof error.body === "object") {
      const message =
        (error.body as { message?: string; detail?: string; error?: string }).message ??
        (error.body as { detail?: string }).detail ??
        (error.body as { error?: string }).error;
      if (message) {
        return `HTTP ${error.status} ${String(message)}`;
      }
      try {
        return `HTTP ${error.status} ${JSON.stringify(error.body)}`;
      } catch {
        return `HTTP ${error.status}`;
      }
    }
    return `HTTP ${error.status}`;
  }
  return String((error as { message?: string } | undefined)?.message ?? error);
}

function pickAgentHeader(
  body: unknown,
  query: Record<string, unknown> | undefined,
): {
  agentId: string | null;
} {
  const queryAgentId =
    typeof query?.["X-Agent-Id"] === "string" && query["X-Agent-Id"].trim()
      ? query["X-Agent-Id"].trim()
      : null;
  const bodyAgentId =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>)["X-Agent-Id"] === "string" &&
    String((body as Record<string, unknown>)["X-Agent-Id"]).trim()
      ? String((body as Record<string, unknown>)["X-Agent-Id"]).trim()
      : null;

  const agentId = bodyAgentId ?? queryAgentId;
  return { agentId };
}

export function createHttpClient(initialDefaults: Partial<HttpClientDefaults> = {}): HttpClient {
  const defaults: HttpClientDefaults = {
    ...initialDefaults,
  };

  async function requestJson<T>(method: "GET" | "POST", params: HttpRequestParams): Promise<T> {
    const merged: HttpRequestConfig = {
      ...defaults,
      ...params.config,
      headers: {
        ...(defaults.headers ?? {}),
        ...(params.config?.headers ?? {}),
      },
    };

    const baseUrl = merged.baseUrl?.trim() || "";
    if (!baseUrl && !/^https?:\/\//i.test(params.url)) {
      throw new Error("Missing baseUrl");
    }

    const { agentId } = pickAgentHeader(params.body, params.query);
    const resolvedUrl = new URL(resolveUrl(baseUrl || params.url, params.url));
    if (params.query) {
      appendQueryParams(resolvedUrl, params.query);
    }

    const headers: Record<string, string> = { ...merged.headers };
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (!headers.Accept && !headers.accept) {
      headers.Accept = "application/json";
    }

    if (!headers.Authorization && !headers.authorization) {
      const token = (await getTipToken()).trim();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
    if (agentId && !headers["X-Agent-Id"] && !headers["x-agent-id"]) {
      headers["X-Agent-Id"] = agentId;
    }
    if (!headers["X-Trace-Id"] && !headers["x-trace-id"]) {
      headers["X-Trace-Id"] = randomUUID();
    }
    if (!headers["X-ArkClaw-Instance-Id"] && !headers["x-arkclaw-instance-id"]) {
      const instanceId = readClawInstanceId();
      if (instanceId) {
        headers["X-ArkClaw-Instance-Id"] = instanceId;
      }
    }

    const init: RequestInit = {
      method,
      headers,
    };

    if (method === "POST") {
      init.body = JSON.stringify(params.body ?? {});
    }

    const timeoutMs =
      Number.isFinite(merged.timeoutMs) && (merged.timeoutMs as number) > 0
        ? Math.max(1_000, merged.timeoutMs as number)
        : 8_000;
    const retries =
      Number.isFinite(merged.retries) && (merged.retries as number) >= 0
        ? Math.max(0, merged.retries as number)
        : 3;

    debugLogRequest("info", "[http][agentdatalake-channel] request", {
      method,
      url: resolvedUrl.toString(),
      query: params.query,
      body: params.body,
      headers: redactHeaders(headers),
      hasAuthorizationHeader: Boolean(headers.Authorization || headers.authorization),
      timeoutMs,
      retries,
    });

    try {
      return await retryAsync(
        async () => {
          const res = await fetchWithTimeout({
            url: resolvedUrl.toString(),
            init,
            timeoutMs,
            signal: merged.signal,
          });
          if (!res.ok) {
            const respBody = await readErrorBody(res);
            throw new HttpStatusError(res.status, respBody, resolvedUrl.toString());
          }
          const rawData = await readJsonBody(res);
          const data = (
            merged.responseAdapter
              ? await merged.responseAdapter(rawData)
              : rawData
          ) as T;
          debugLogRequest("info", "[http][agentdatalake-channel] response", {
            method,
            url: resolvedUrl.toString(),
            status: res.status,
            rawData: rawData,
          });
          return data;
        },
        retries,
        120,
      );
    } catch (error) {
      debugLogRequest("error", "[http][agentdatalake-channel] error", {
        method,
        url: resolvedUrl.toString(),
        error: formatApiError(error),
      });
      throw error;
    }
  }

  return {
    configure(nextDefaults: Partial<HttpClientDefaults>) {
      const prevHeaders = defaults.headers;
      Object.assign(defaults, nextDefaults);
      if (nextDefaults.headers) {
        defaults.headers = {
          ...(prevHeaders ?? {}),
          ...(nextDefaults.headers ?? {}),
        };
      }
    },
    get<T>(params: Omit<HttpRequestParams, "body">) {
      return requestJson<T>("GET", params as HttpRequestParams);
    },
    post<T = unknown>(params: HttpRequestParams) {
      return requestJson<T>("POST", params);
    },
  };
}

export const http = createHttpClient();
