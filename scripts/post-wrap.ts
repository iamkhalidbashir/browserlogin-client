import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const source = process.env.ELECTROBUN_BASELINE_BUN_PATH;
if (!source) process.exit(0);

const wrapper = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
if (!wrapper) throw new Error("baseline Bun replacement requires a wrapper path");
if (!existsSync(source)) throw new Error(`baseline Bun is missing: ${source}`);

const bundledBun = join(wrapper, "bin", "bun");
copyFileSync(source, bundledBun);
chmodSync(bundledBun, 0o755);
