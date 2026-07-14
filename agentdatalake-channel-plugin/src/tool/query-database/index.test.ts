import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../request/identity.js", () => ({
  getTipToken: vi.fn(),
}));

import { globalState } from "../../global-state.js";
import { getTipToken } from "../../request/identity.js";
import { http } from "../../request/index.js";
import { buildQueryDatabaseRequest, registerQueryDatabaseTool } from "./index.js";

const TEST_DATA_PATH = "tos://<bucket>/08-clawlake/fts_embed.lance";

type CapturedTool = {
  name: string;
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
};

type CaptureApi = {
  registerTool: (tool: (ctx: unknown) => CapturedTool) => void;
};

function captureTool(): CapturedTool {
  let captured: CapturedTool | null = null;
  registerQueryDatabaseTool({
    registerTool(tool: (ctx: unknown) => CapturedTool) {
      captured = tool({});
    },
  } as CaptureApi as never);
  if (!captured) {
    throw new Error("tool was not registered");
  }
  return captured;
}

describe("query_database tool", () => {
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

  test("buildQueryDatabaseRequest maps and trims backend fields", () => {
    expect(
      buildQueryDatabaseRequest({
        DataPath: ` ${TEST_DATA_PATH} `,
        Query: " 查一下用户信息 ",
        FtsColumn: " content ",
        VectorColumn: " embedding ",
        Filter: " created_by = 'user-1' ",
        Columns: [" content ", " created_at "],
        TopK: 5,
      }),
    ).toEqual({
      DataPath: TEST_DATA_PATH,
      Query: "查一下用户信息",
      FtsColumn: "content",
      VectorColumn: "embedding",
      Filter: "claw_id = 'ci-test-instance' and (created_by = 'user-1')",
      Columns: ["content", "created_at"],
      TopK: 5,
    });
  });

  test("buildQueryDatabaseRequest applies search and response column defaults", () => {
    expect(
      buildQueryDatabaseRequest({
        DataPath: TEST_DATA_PATH,
        Query: "查一下用户信息",
      }),
    ).toEqual({
      DataPath: TEST_DATA_PATH,
      Query: "查一下用户信息",
      FtsColumn: "content",
      VectorColumn: "embedding",
      Filter: "claw_id = 'ci-test-instance'",
      Columns: ["content", "created_at", "speaker_id"],
    });
  });

  test("buildQueryDatabaseRequest supports filter-only requests", () => {
    expect(
      buildQueryDatabaseRequest({
        DataPath: TEST_DATA_PATH,
        Filter: "created_by = 'user-1'",
      }),
    ).toEqual({
      DataPath: TEST_DATA_PATH,
      Filter: "claw_id = 'ci-test-instance' and (created_by = 'user-1')",
      Columns: ["content", "created_at", "speaker_id"],
    });
  });

  test("buildQueryDatabaseRequest escapes the instance id SQL literal", () => {
    vi.stubEnv("CLAW_INSTANCE_ID", "ci-test'instance");

    expect(
      buildQueryDatabaseRequest({
        DataPath: TEST_DATA_PATH,
      }),
    ).toMatchObject({
      Filter: "claw_id = 'ci-test''instance'",
    });
  });

  test("buildQueryDatabaseRequest fails closed when instance id is unavailable", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("HOME", "/tmp/agentdatalake-channel-plugin-no-openclaw-env");

    expect(() =>
      buildQueryDatabaseRequest({
        DataPath: TEST_DATA_PATH,
      }),
    ).toThrow("CLAW_INSTANCE_ID is required");
  });

  test("posts to ClawLake search endpoint and formats direct DataItems response", async () => {
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

    const tool = captureTool();
    const result = (await tool.execute("call-1", {
      DataPath: TEST_DATA_PATH,
      Query: "查一下用户信息",
      Filter: "created_by = 'user-1'",
      TopK: 3,
    })) as {
      content: Array<{ text: string }>;
      details: Record<string, unknown>;
    };

    expect(tool.name).toBe("query_database");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(
      "https://example.com/memory_cp/api/v1/dataItem/search",
    );
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      DataPath: TEST_DATA_PATH,
      Query: "查一下用户信息",
      FtsColumn: "content",
      VectorColumn: "embedding",
      Filter: "claw_id = 'ci-test-instance' and (created_by = 'user-1')",
      Columns: ["content", "created_at", "speaker_id"],
      TopK: 3,
    });
    expect(result.content[0]?.text).toContain("query_database retrieved 1 item");
    expect(result.content[0]?.text).toContain("用户 A 的测试记录");
    expect(result.details).toMatchObject({
      status: "ok",
      endpoint: "/memory_cp/api/v1/dataItem/search",
      request: {
        DataPath: TEST_DATA_PATH,
        Query: "查一下用户信息",
        FtsColumn: "content",
        VectorColumn: "embedding",
        Filter: "claw_id = 'ci-test-instance' and (created_by = 'user-1')",
        Columns: ["content", "created_at", "speaker_id"],
        TopK: 3,
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
    });
  });

  test("accepts old ClawLake envelope shape when backend wraps Result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            RequestId: "req-1",
          },
          Result: {
            Items: [
              {
                DataItems: [
                  {
                    ColumnName: "content",
                    ColumnValue: "wrapped result",
                  },
                ],
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const tool = captureTool();
    const result = (await tool.execute("call-2", {
      DataPath: TEST_DATA_PATH,
      Query: "wrapped",
    })) as {
      details: Record<string, unknown>;
    };

    expect(result.details).toMatchObject({
      status: "ok",
      responseMetadata: {
        RequestId: "req-1",
      },
      items: [
        {
          DataItems: [
            {
              ColumnName: "content",
              ColumnValue: "wrapped result",
            },
          ],
        },
      ],
      rows: [
        {
          content: "wrapped result",
        },
      ],
    });
  });

  test("normalizes latest backend Value fields into ColumnValue", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            RequestId: "req-value",
          },
          Result: {
            Items: [
              {
                DataItems: [
                  {
                    ColumnName: "content",
                    Value: "我爱吃西瓜，从小开始喜欢的",
                  },
                  {
                    ColumnName: "created_at",
                    Value: "2026-05-07T09:25:58.441512+00:00",
                  },
                  {
                    ColumnName: "created_by",
                    Value: "fastapi-service",
                  },
                ],
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const tool = captureTool();
    const result = (await tool.execute("call-value", {
      DataPath: TEST_DATA_PATH,
      Query: "测试查询用户信息",
    })) as {
      content: Array<{ text: string }>;
      details: Record<string, unknown>;
    };

    expect(result.content[0]?.text).toContain("我爱吃西瓜，从小开始喜欢的");
    expect(result.details).toMatchObject({
      status: "ok",
      responseMetadata: {
        RequestId: "req-value",
      },
      items: [
        {
          DataItems: [
            {
              ColumnName: "content",
              ColumnValue: "我爱吃西瓜，从小开始喜欢的",
            },
            {
              ColumnName: "created_at",
              ColumnValue: "2026-05-07T09:25:58.441512+00:00",
            },
            {
              ColumnName: "created_by",
              ColumnValue: "fastapi-service",
            },
          ],
        },
      ],
      rows: [
        {
          content: "我爱吃西瓜，从小开始喜欢的",
          created_at: "2026-05-07T09:25:58.441512+00:00",
          created_by: "fastapi-service",
        },
      ],
    });
  });

  test("normalizes DatasetDataItem response into stable DataItems output", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            RequestId: "req-dataset-data-item",
          },
          Result: {
            Items: [
              {
                DatasetDataItem: [
                  {
                    ColumnName: "gender",
                    ColumnValue: "male",
                    IsTruncated: false,
                    AvDuration: null,
                  },
                  {
                    ColumnName: "speaker_id",
                    ColumnValue: "SPK_90a5bcbcbf98",
                    IsTruncated: false,
                    AvDuration: null,
                  },
                ],
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const tool = captureTool();
    const result = (await tool.execute("call-dataset-data-item", {
      DataPath: TEST_DATA_PATH,
      Query: "查一下用户信息",
    })) as {
      content: Array<{ text: string }>;
      details: Record<string, unknown>;
    };

    expect(result.content[0]?.text).toContain("SPK_90a5bcbcbf98");
    expect(result.details).toMatchObject({
      status: "ok",
      responseMetadata: {
        RequestId: "req-dataset-data-item",
      },
      items: [
        {
          DataItems: [
            {
              ColumnName: "gender",
              ColumnValue: "male",
              IsTruncated: false,
              AvDuration: null,
            },
            {
              ColumnName: "speaker_id",
              ColumnValue: "SPK_90a5bcbcbf98",
              IsTruncated: false,
              AvDuration: null,
            },
          ],
        },
      ],
      rows: [
        {
          gender: "male",
          speaker_id: "SPK_90a5bcbcbf98",
        },
      ],
    });
  });

  test("converts backend HTTP error into normal tool result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            Error: {
              Message: "DataPath is invalid",
              Notice: "dataset not found",
            },
          },
          Result: null,
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const tool = captureTool();
    const result = (await tool.execute("call-3", {
      DataPath: "tos://<bucket>/08-clawlake/missing.lance",
      Query: "查一下用户信息",
    })) as {
      content: Array<{ text: string }>;
      details: Record<string, unknown>;
    };

    expect(result.content[0]?.text).toContain("HTTP 400");
    expect(result.content[0]?.text).toContain("DataPath is invalid");
    expect(result.details).toMatchObject({
      status: "http_error",
      endpoint: "/memory_cp/api/v1/dataItem/search",
      httpStatus: 400,
      message: "DataPath is invalid Notice: dataset not found",
      notice: "dataset not found",
    });
  });

  test("validates required fields before sending request", async () => {
    const tool = captureTool();
    await expect(
      tool.execute("call-4", {
        DataPath: "   ",
      }),
    ).rejects.toThrow("DataPath is required");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("validates optional fields before sending request", async () => {
    const tool = captureTool();
    await expect(
      tool.execute("call-5", {
        DataPath: TEST_DATA_PATH,
        Columns: ["content", "   "],
      }),
    ).rejects.toThrow("Columns must contain non-empty strings");
    await expect(
      tool.execute("call-6", {
        DataPath: TEST_DATA_PATH,
        TopK: 0,
      }),
    ).rejects.toThrow("TopK must be a positive integer");
    expect(fetch).not.toHaveBeenCalled();
  });
});
