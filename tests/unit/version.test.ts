import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import electrobunConfig from "../../electrobun.config";
import { VERSION } from "../../src/shared/version";

describe("package version", () => {
  it("keeps every release identity at 0.1.31", async () => {
    const manifest: { readonly version: string } = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(VERSION).toBe("0.1.31");
    expect(manifest.version).toBe(VERSION);
    expect(electrobunConfig.app.version).toBe(VERSION);
  });
});
