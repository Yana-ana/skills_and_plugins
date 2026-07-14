function resolveVersion(): string {
  // Rspack injects this at build time (see rspack.config.mjs).
  // Use `typeof` so the identifier being absent does not crash in non-bundled contexts.
  if (typeof __PLUGIN_VERSION__ !== "undefined") {
    const version = String(__PLUGIN_VERSION__ ?? "").trim();
    if (version) return version;
  }

  // In non-bundled contexts (for example direct ts-node runs), fall back to a safe default.
  // Do not read package.json at runtime; OpenClaw may sandbox plugin filesystem access.
  return "0.0.0";
}

export const PLUGIN_VERSION = resolveVersion();
