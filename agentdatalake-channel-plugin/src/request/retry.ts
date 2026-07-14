export type RetryConfig = {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
};

export type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  err: unknown;
  label?: string;
};

export type RetryOptions = RetryConfig & {
  label?: string;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  retryAfterMs?: (err: unknown) => number | undefined;
  onRetry?: (info: RetryInfo) => void;
};

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 5000,
  jitter: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function applyJitter(delayMs: number, jitter: number): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return 0;
  }
  if (!Number.isFinite(jitter) || jitter <= 0) {
    return delayMs;
  }
  const factor = 1 + (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs * factor));
}

export function resolveRetryConfig(
  defaults: Required<RetryConfig> = DEFAULT_RETRY_CONFIG,
  overrides?: RetryConfig,
): Required<RetryConfig> {
  return {
    attempts: Math.max(1, Math.round(overrides?.attempts ?? defaults.attempts)),
    minDelayMs: Math.max(0, Math.round(overrides?.minDelayMs ?? defaults.minDelayMs)),
    maxDelayMs: Math.max(0, Math.round(overrides?.maxDelayMs ?? defaults.maxDelayMs)),
    jitter: clamp(overrides?.jitter ?? defaults.jitter, 0, 1),
  };
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  attemptsOrOptions: number | RetryOptions = 3,
  initialDelayMs = 300,
): Promise<T> {
  if (typeof attemptsOrOptions === "number") {
    const attempts = Math.max(1, Math.round(attemptsOrOptions));
    let lastErr: unknown;
    for (let index = 0; index < attempts; index += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (index === attempts - 1) {
          break;
        }
        await sleep(initialDelayMs * 2 ** index);
      }
    }
    throw lastErr ?? new Error("Retry failed");
  }

  const options = attemptsOrOptions;
  const resolved = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
  const maxAttempts = resolved.attempts;
  const minDelayMs = resolved.minDelayMs;
  const maxDelayMs =
    Number.isFinite(resolved.maxDelayMs) && resolved.maxDelayMs > 0
      ? resolved.maxDelayMs
      : Number.POSITIVE_INFINITY;
  const jitter = resolved.jitter;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        break;
      }
      const retryAfterMs = options.retryAfterMs?.(err);
      const baseDelay =
        typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
          ? Math.max(retryAfterMs, minDelayMs)
          : minDelayMs * 2 ** (attempt - 1);
      let delayMs = Math.min(baseDelay, maxDelayMs);
      delayMs = applyJitter(delayMs, jitter);
      delayMs = Math.min(Math.max(delayMs, minDelayMs), maxDelayMs);
      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        err,
        label: options.label,
      });
      await sleep(delayMs);
    }
  }

  throw lastErr ?? new Error("Retry failed");
}
