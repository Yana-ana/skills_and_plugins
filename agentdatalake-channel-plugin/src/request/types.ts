export type HttpClientDefaults = {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  responseAdapter?: (data: any) => any | Promise<any>;
};

export type HttpRequestConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  responseAdapter?: (data: any) => any | Promise<any>;
};

export type HttpRequestParams = {
  url: string;
  query?: Record<string, unknown>;
  body?: unknown;
  config?: HttpRequestConfig;
};

export type HttpClient = {
  configure(defaults: Partial<HttpClientDefaults>): void;
  get<T>(params: Omit<HttpRequestParams, "body">): Promise<T>;
  post<T = unknown>(params: HttpRequestParams): Promise<T>;
};
