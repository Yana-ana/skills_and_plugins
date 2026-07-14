import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/core";

export type RegisterGatewayApi = Pick<
  OpenClawPluginApi,
  "registerGatewayMethod"
>;

export type GatewayErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type GatewayPayload = GatewayRequestHandlerOptions & {
  params: Record<string, unknown>;
};
