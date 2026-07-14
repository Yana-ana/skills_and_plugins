export type PluginConfig = {
  debug?: boolean;
  /**
   * Default base URL for the shared HTTP client in `src/request`.
   */
  baseUrl: string;
};

declare const __AGENTDATALAKE_DEFAULT_BASE_URL__: string | undefined;

export const APIG_BASE_URL_BY_ENV = {
  prod: "http://sd80qehkc19oii7djnm20.apigateway-cn-beijing.volceapi.com",
} as const;

export type BuildEnvironment = keyof typeof APIG_BASE_URL_BY_ENV;

const DEFAULT_BUILD_ENVIRONMENT: BuildEnvironment = "prod";

type ParseOptions = Record<string, never>;

function normalizeBaseUrl(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\/+$/, "")
    : "";
}

function readBundledDefaultBaseUrl(): string {
  return typeof __AGENTDATALAKE_DEFAULT_BASE_URL__ === "string"
    ? __AGENTDATALAKE_DEFAULT_BASE_URL__
    : "";
}

export const DEFAULT_BASE_URL =
  normalizeBaseUrl(readBundledDefaultBaseUrl()) ||
  APIG_BASE_URL_BY_ENV[DEFAULT_BUILD_ENVIRONMENT];

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function resolveBaseUrl(): string {
  return DEFAULT_BASE_URL;
}

/**
 * Lightweight plugin config schema:
 * - a lightweight `parse(...)` that throws on invalid input
 * - optional `uiHints` for OpenClaw config UIs
 */
export const pluginConfigSchema = {
  parse(value: unknown, _options: ParseOptions = {}): PluginConfig {
    // Host may omit plugin config entirely; treat that as "use defaults".
    if (value == null) {
      value = {};
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ["debug", "baseUrl"], "plugin config");

    const debug = typeof cfg.debug === "boolean" ? cfg.debug : false;
    const baseUrl = resolveBaseUrl();

    return { debug, baseUrl };
  },
  uiHints: {
    baseUrl: {
      label: "Base URL",
      placeholder: DEFAULT_BASE_URL,
      advanced: true,
      help: "Bundled base URL for this plugin build. Select CUSTOM_TYPE at build time to change it.",
    },
    debug: {
      label: "Debug",
      advanced: true,
      help: "Enable verbose debug logging for this plugin. Disabled by default.",
    },
  },
};
