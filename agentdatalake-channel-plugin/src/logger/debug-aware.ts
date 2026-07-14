import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { GlobalLogger } from "../global-state.js";
import { globalState } from "../global-state.js";

export function createDebugAwareLogger(api: OpenClawPluginApi): GlobalLogger {
  return {
    info(message: string) {
      if (!globalState.debug) {
        return;
      }
      api.logger.info?.(message);
    },
    warn(message: string) {
      if (!globalState.debug) {
        return;
      }
      api.logger.warn?.(message);
    },
    error(message: string) {
      if (!globalState.debug) {
        return;
      }
      api.logger.error?.(message);
    },
  };
}
