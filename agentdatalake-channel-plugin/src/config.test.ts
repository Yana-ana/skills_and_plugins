import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  APIG_BASE_URL_BY_ENV,
  DEFAULT_BASE_URL,
  pluginConfigSchema,
} from "./config.js";

describe("plugin config schema", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("HOME", "/tmp/agentdatalake-channel-plugin-no-openclaw-env");
  });

  test("defaults debug logging off", () => {
    expect(pluginConfigSchema.parse(undefined)).toEqual({
      debug: false,
      baseUrl: APIG_BASE_URL_BY_ENV.prod,
    });
    expect(DEFAULT_BASE_URL).toBe(APIG_BASE_URL_BY_ENV.prod);
  });

  test("allows debug while keeping the bundled baseUrl", () => {
    expect(
      pluginConfigSchema.parse({
        debug: true,
        baseUrl: " https://example.com/ ",
      }),
    ).toEqual({
      debug: true,
      baseUrl: APIG_BASE_URL_BY_ENV.prod,
    });
  });

  test("ignores runtime baseUrl so the packaged environment stays fixed", () => {
    expect(
      pluginConfigSchema.parse({
        baseUrl: " https://configured.example.com/ ",
      }),
    ).toEqual({
      debug: false,
      baseUrl: APIG_BASE_URL_BY_ENV.prod,
    });
  });

  test("does not use CLAW_APIG_DOMAIN at runtime", () => {
    vi.stubEnv("CLAW_APIG_DOMAIN", "https://runtime.example.com");

    expect(pluginConfigSchema.parse(undefined)).toEqual({
      debug: false,
      baseUrl: APIG_BASE_URL_BY_ENV.prod,
    });
  });

  test("documents the build environment APIG map", () => {
    expect(APIG_BASE_URL_BY_ENV).toEqual({
      prod: "http://sd80qehkc19oii7djnm20.apigateway-cn-beijing.volceapi.com",
    });
  });
});
