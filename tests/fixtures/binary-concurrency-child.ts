import { ensureBinary } from "../../src/core/binary/index.js";

const [root, downloadUrl, requestedVersion] = process.argv.slice(2);
if (!root || !downloadUrl || !requestedVersion)
  throw new Error("missing fixture arguments");

await ensureBinary({
  cacheDirectory: root,
  downloadUrl,
  requestedVersion,
  platform: "win32",
  arch: "x64",
});
