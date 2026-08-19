import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
};

describe("runtime dependencies", () => {
  it("ships the CloakBrowser GeoIP peer as a production dependency", async () => {
    const manifest: PackageManifest = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(manifest.dependencies?.["mmdb-lib"]).toMatch(/^\^?3\./);
  });
});
