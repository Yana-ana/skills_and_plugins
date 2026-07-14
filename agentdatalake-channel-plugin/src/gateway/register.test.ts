import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../request/identity.js", () => ({
  getTipToken: vi.fn(),
}));

import { globalState } from "../global-state.js";
import { getTipToken } from "../request/identity.js";
import { http } from "../request/index.js";
import { registerGateways } from "./register.js";

const TEST_DATA_PATH = "tos://<bucket>/08-clawlake/fts_embed.lance";

type CapturedGateway = (payload: {
  params: Record<string, unknown>;
  respond: (ok: boolean, result?: unknown, error?: unknown) => void;
}) => Promise<void> | void;

function captureGateways(): Map<string, CapturedGateway> {
  const methods = new Map<string, CapturedGateway>();
  registerGateways({
    api: {
      registerGatewayMethod(name: string, handler: CapturedGateway) {
        methods.set(name, handler);
      },
    },
  } as never);
  return methods;
}

async function invokeGateway(
  methods: Map<string, CapturedGateway>,
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; result?: unknown; error?: unknown }> {
  const handler = methods.get(name);
  if (!handler) {
    throw new Error(`gateway not registered: ${name}`);
  }

  let response: { ok: boolean; result?: unknown; error?: unknown } | null = null;
  await handler({
    params,
    respond(ok, result, error) {
      response = { ok, result, error };
    },
  });

  if (!response) {
    throw new Error(`gateway did not respond: ${name}`);
  }
  return response;
}

describe("gateway methods", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("CLAW_INSTANCE_ID", "ci-test-instance");
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(getTipToken).mockResolvedValue("tip-token");
    http.configure({ baseUrl: "https://example.com", retries: 0 });
    globalState.baseUrl = "https://example.com";
    globalState.logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    globalState.debug = false;
  });

  test("registers status and query_database gateway methods", () => {
    const methods = captureGateways();

    expect(Array.from(methods.keys()).sort()).toEqual([
      "agentdatalake-channel-plugin.query_database",
      "agentdatalake-channel-plugin.status.get",
      "agentdatalake-channel-plugin.status.version",
    ]);
  });

  test("status.get returns runtime query configuration", async () => {
    const response = await invokeGateway(
      captureGateways(),
      "agentdatalake-channel-plugin.status.get",
    );

    expect(response).toEqual({
      ok: true,
      result: {
        ok: true,
        baseUrl: "https://example.com",
        endpoint: "/memory_cp/api/v1/dataItem/search",
        tool: "query_database",
      },
      error: undefined,
    });
  });

  test("query_database gateway reuses backend query behavior", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          Items: [
            {
              DataItems: [
                {
                  ColumnName: "content",
                  ColumnValue: "用户 A 的测试记录",
                },
                {
                  ColumnName: "created_at",
                  ColumnValue: "2026-05-08T19:00:00Z",
                },
                {
                  ColumnName: "created_by",
                  ColumnValue: "user-1",
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const response = await invokeGateway(
      captureGateways(),
      "agentdatalake-channel-plugin.query_database",
      {
        DataPath: TEST_DATA_PATH,
        Query: "查一下用户信息",
        Filter: "created_by = 'user-1'",
      },
    );

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.result).toMatchObject({
      details: {
        status: "ok",
        endpoint: "/memory_cp/api/v1/dataItem/search",
        request: {
          DataPath: TEST_DATA_PATH,
          Query: "查一下用户信息",
          FtsColumn: "content",
          VectorColumn: "embedding",
          Filter: "claw_id = 'ci-test-instance' and (created_by = 'user-1')",
          Columns: ["content", "created_at", "speaker_id"],
        },
        items: [
          {
            DataItems: [
              {
                ColumnName: "content",
                ColumnValue: "用户 A 的测试记录",
              },
              {
                ColumnName: "created_at",
                ColumnValue: "2026-05-08T19:00:00Z",
              },
              {
                ColumnName: "created_by",
                ColumnValue: "user-1",
              },
            ],
          },
        ],
        rows: [
          {
            content: "用户 A 的测试记录",
            created_at: "2026-05-08T19:00:00Z",
            created_by: "user-1",
          },
        ],
      },
    });
  });

  test("query_database gateway responds with structured error for invalid params", async () => {
    const response = await invokeGateway(
      captureGateways(),
      "agentdatalake-channel-plugin.query_database",
      {
        DataPath: "   ",
      },
    );

    expect(response).toEqual({
      ok: false,
      result: null,
      error: {
        code: "-32000",
        message: "DataPath is required",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
