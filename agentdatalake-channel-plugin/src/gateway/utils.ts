import type { GatewayErrorPayload } from "./types.js";

export function toGatewayErrorPayload(
  error: unknown,
  code = "-32000",
): GatewayErrorPayload {
  if (error instanceof Error) {
    const withDetails = error as Error & { details?: unknown };
    return {
      code,
      message: error.message,
      details: withDetails.details,
    };
  }

  return {
    code,
    message: String(error),
  };
}
