import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

if (
  process.env.ELECTROBUN_OS === "linux" &&
  process.env.ELECTROBUN_ARCH === "x64"
) {
  const source = process.env.ELECTROBUN_BASELINE_BUN_PATH;
  const wrapper = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
  if (!source || !wrapper) {
    throw new Error("Linux x64 release requires a baseline Bun wrapper path");
  }
  if (!existsSync(source)) throw new Error(`baseline Bun is missing: ${source}`);

  const bundledBun = join(wrapper, "bin", "bun");
  copyFileSync(source, bundledBun);
  chmodSync(bundledBun, 0o755);
}
