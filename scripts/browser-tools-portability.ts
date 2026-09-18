import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const packageSchema = z.object({
  name: z.string(),
  version: z.string(),
});

export type BrowserToolsBundleAssets = Readonly<{
  packageIdentity: Readonly<{ name: string; version: string }>;
  browserRegistry: unknown;
  webpWasmBase64: string;
}>;

type BundleReplacement = Readonly<{
  label: string;
  pattern: RegExp;
  replacement: string;
}>;

export class BrowserToolsPortabilityError extends Error {
  constructor(label: string) {
    super(`browser tools portability transform failed: ${label}`);
    this.name = "BrowserToolsPortabilityError";
  }
}

const replaceExactly = (source: string, change: BundleReplacement): string => {
  const matches = source.match(new RegExp(change.pattern.source, "g"));
  if (matches?.length !== 1)
    throw new BrowserToolsPortabilityError(change.label);
  return source.replace(change.pattern, change.replacement);
};

export async function readBrowserToolsBundleAssets(
  root: string,
): Promise<BrowserToolsBundleAssets> {
  const playwrightRoot = join(root, "node_modules", "playwright-core");
  const [packageSource, browserSource, webpWasm] = await Promise.all([
    readFile(join(playwrightRoot, "package.json"), "utf8"),
    readFile(join(playwrightRoot, "browsers.json"), "utf8"),
    readFile(join(playwrightRoot, "lib", "webp_codec.wasm")),
  ]);
  return {
    packageIdentity: packageSchema.parse(JSON.parse(packageSource)),
    browserRegistry: JSON.parse(browserSource),
    webpWasmBase64: webpWasm.toString("base64"),
  };
}

export function makeBrowserToolsBundlePortable(
  bundle: string,
  assets: BrowserToolsBundleAssets,
): string {
  const browserRegistry = JSON.stringify(assets.browserRegistry);
  if (!browserRegistry)
    throw new BrowserToolsPortabilityError("browser registry serialization");

  const changes: readonly BundleReplacement[] = [
    {
      label: "playwright-core bundle location",
      pattern:
        /var __dirname = "[^"\n]*playwright-core[^"\n]*lib", __filename = "[^"\n]*playwright-core[^"\n]*coreBundle\.js";/,
      replacement: 'var __dirname = ".", __filename = "coreBundle.js";',
    },
    {
      label: "playwright-core package bootstrap",
      pattern:
        /([ \t]+)packageRoot = ([A-Za-z_$][\w$]*)\.default\.join\(__dirname, "\.\."\);\n\1packageJSON = [A-Za-z_$][\w$]*\(\2\.default\.join\(packageRoot, "package\.json"\)\);\n\1binPath = \2\.default\.join\(packageRoot, "bin"\);/,
      replacement: `$1packageRoot = ".";
$1packageJSON = ${JSON.stringify(assets.packageIdentity)};
$1binPath = packageRoot;`,
    },
    {
      label: "playwright-core browser registry",
      pattern:
        /([ \t]+)registry = new Registry\([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.default\.join\(packageRoot, "browsers\.json"\)\)\);/,
      replacement: `$1registry = new Registry(${browserRegistry});`,
    },
    {
      label: "playwright-core WebP codec",
      pattern:
        /[A-Za-z_$][\w$]*\.default\.readFileSync\([A-Za-z_$][\w$]*\.default\.join\(__dirname, "webp_codec\.wasm"\)\)/,
      replacement: `Buffer.from(${JSON.stringify(assets.webpWasmBase64)}, "base64")`,
    },
  ];

  const portable = changes.reduce(replaceExactly, bundle);
  if (
    /"(?:[A-Za-z]:[\\/]|\/)[^"\n]*node_modules[\\/]playwright-core/.test(
      portable,
    )
  )
    throw new BrowserToolsPortabilityError("absolute playwright-core path");
  return portable;
}
