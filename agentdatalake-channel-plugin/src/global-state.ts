export type GlobalLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type GlobalState = {
  debug: boolean;
  logger: GlobalLogger | null;
  baseUrl: string;
};

export const globalState: GlobalState = {
  debug: false,
  logger: null,
  baseUrl: "",
};
