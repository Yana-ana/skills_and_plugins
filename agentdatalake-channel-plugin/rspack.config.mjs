import fs from "node:fs";
import path from "node:path";
import rspack from "@rspack/core";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);
const defaultBaseUrl = process.env.AGENTDATALAKE_DEFAULT_BASE_URL ?? "";

/** @type {import("@rspack/cli").Configuration} */
const config = {
  mode: "production",
  target: "node",
  entry: {
    index: "./src/index.ts",
  },
  experiments: {
    outputModule: true,
  },
  output: {
    path: path.resolve(process.cwd()),
    filename: "index.js",
    module: true,
    // Emit a real ESM library so `import("./index.js")` exposes exports.
    library: {
      type: "module",
    },
    // Never clean the project root when writing the bundle beside package.json.
    clean: false,
  },
  devtool: false,
  resolve: {
    extensions: [".ts", ".js", ".json"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
            },
            target: "es2022",
          },
        },
        type: "javascript/esm",
      },
    ],
  },
  plugins: [
    // Avoid runtime filesystem lookups; OpenClaw may sandbox plugin filesystem access.
    new rspack.DefinePlugin({
      __PLUGIN_VERSION__: JSON.stringify(pkg.version ?? ""),
      __AGENTDATALAKE_DEFAULT_BASE_URL__: JSON.stringify(defaultBaseUrl),
    }),
  ],
  externalsType: "module",
  externals: [
    /^node:/,
    /^openclaw(?:\/.*)?$/,
    /^@sinclair\/typebox$/,
  ],
  optimization: {
    splitChunks: false,
    minimize: false,
    // This is a library-style bundle consumed by the host (OpenClaw).
    // Keep entry exports even if they look unused from within the bundle.
    usedExports: false,
  },
};

export default config;
