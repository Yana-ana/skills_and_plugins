import { beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("./identity.js", () => ({
  getTipToken: vi.fn(),
}));

import { getTipToken } from "./identity.js";
import { createHttpClient, readClawInstanceId } from "./index.js";
import { globalState } from "../global-state.js";

describe("http request client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.unstubAllEnvs();
    vi.stubEnv("HOME", "/tmp/agentdatalake-channel-plugin-no-openclaw-env");
    vi.mocked(getTipToken).mockResolvedValue("tip-token");
    globalState.debug = false;
    globalState.logger = null;
  });

  test("adds Bearer Authorization from identity tip token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createHttpClient({
      baseUrl: "https://example.com",
      retries: 0,
    });

    await client.post({
      url: "/api/query",
      body: { query: "hello" },
    });

    const [_url, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tip-token");
    expect(headers["X-Trace-Id"]).toBeTruthy();
  });

  test("adds OpenClaw instance id when injected by runtime", async () => {
    vi.stubEnv("CLAW_INSTANCE_ID", "claw-instance-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createHttpClient({
      baseUrl: "https://example.com",
      retries: 0,
    });

    await client.post({
      url: "/api/query",
      body: { query: "hello" },
    });

    const [_url, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-ArkClaw-Instance-Id"]).toBe("claw-instance-1");
  });

  test("reads OpenClaw instance id from ~/.openclaw/.env", () => {
    const home = fs.mkdtempSync(
      path.join(os.tmpdir(), "agentdatalake-channel-plugin-"),
    );
    fs.mkdirSync(path.join(home, ".openclaw"));
    fs.writeFileSync(
      path.join(home, ".openclaw", ".env"),
      "CLAW_INSTANCE_ID=ci-from-env-file\n",
      "utf8",
    );
    vi.unstubAllEnvs();
    vi.stubEnv("HOME", home);

    expect(readClawInstanceId()).toBe("ci-from-env-file");
  });

  test("does not override explicit Authorization header", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createHttpClient({
      baseUrl: "https://example.com",
      retries: 0,
    });

    await client.post({
      url: "/api/query",
      body: {},
      config: {
        headers: {
          Authorization: "Raw explicit-token",
        },
      },
    });

    const [_url, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Raw explicit-token");
    expect(getTipToken).not.toHaveBeenCalled();
  });

  test("redacts Authorization from debug request logs", async () => {
    const info = vi.fn();
    globalState.debug = true;
    globalState.logger = {
      info,
      error: vi.fn(),
    };
    vi.mocked(getTipToken).mockResolvedValue("very-secret-tip-token");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createHttpClient({
      baseUrl: "https://example.com",
      retries: 0,
    });

    await client.post({
      url: "/api/query",
      body: { query: "hello" },
    });

    const logs = info.mock.calls.map(([message]) => String(message)).join("\n");
    expect(logs).toContain("Bearer <redacted>");
    expect(logs).toContain('"hasAuthorizationHeader":true');
    expect(logs).not.toContain("very-secret-tip-token");
  });
});
