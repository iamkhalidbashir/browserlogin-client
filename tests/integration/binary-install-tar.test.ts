import { gzipSync } from "node:zlib";
import {
  lstat,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installBinary } from "../../src/core/binary/install.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function writeOctal(
  header: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset);
}

function tarHeader(
  name: string,
  type: "0" | "2",
  size: number,
  linkName = "",
  prefix = "",
): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  writeOctal(header, type === "0" ? 0o755 : 0o777, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1);
  header.write(linkName, 157, 100);
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  header.write(prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function tarGz(
  files: ReadonlyArray<
    readonly [name: string, contents: string, prefix?: string]
  >,
  links: ReadonlyArray<readonly [name: string, target: string]>,
): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, contents, prefix] of files) {
    const data = Buffer.from(contents);
    blocks.push(tarHeader(name, "0", data.length, "", prefix), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  for (const [name, target] of links)
    blocks.push(tarHeader(name, "2", 0, target));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe("CloakBrowser tar installation", () => {
  it.skipIf(process.platform === "win32")("installs an official macOS runtime containing relative framework symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-tar-links-"));
    roots.push(root);
    const archive = join(root, "cloakbrowser-darwin-arm64.tar.gz");
    await writeFile(
      archive,
      tarGz(
        [
          ["Chromium.app/Contents/MacOS/Chromium", "binary"],
          [
            "Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/145/marker",
            "framework",
          ],
        ],
        [
          [
            "Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/Current",
            "145",
          ],
        ],
      ),
    );

    const info = await installBinary({
      archive,
      root,
      version: "145.0.0.0",
      pro: false,
      platform: "darwin-arm64",
      sha256: "archive-sha",
      source: "official",
      trust: "verified",
    });

    const current = join(
      root,
      "browser-runtime/browsers/darwin-arm64-145.0.0.0/Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/Current",
    );
    expect(info.path).toContain("Chromium.app/Contents/MacOS/Chromium");
    expect((await lstat(current)).isSymbolicLink()).toBe(true);
    expect(await readlink(current)).toBe("145");
  });

  it("rejects a tar symlink whose target escapes the staging tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-tar-escape-"));
    roots.push(root);
    const archive = join(root, "cloakbrowser-darwin-arm64.tar.gz");
    await writeFile(
      archive,
      tarGz(
        [["Chromium.app/Contents/MacOS/Chromium", "binary"]],
        [["Chromium.app/escape", "../../outside"]],
      ),
    );

    await expect(
      installBinary({
        archive,
        root,
        version: "145.0.0.0",
        pro: false,
        platform: "darwin-arm64",
        sha256: "archive-sha",
        source: "official",
        trust: "verified",
      }),
    ).rejects.toMatchObject({ code: "INSTALL_FAILED" });
  });

  it.skipIf(process.platform === "win32")("installs USTAR-prefixed framework entries inside the macOS app bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-tar-prefix-"));
    roots.push(root);
    const archive = join(root, "cloakbrowser-darwin-arm64.tar.gz");
    await writeFile(
      archive,
      tarGz(
        [
          ["Chromium.app/Contents/MacOS/Chromium", "binary"],
          [
            "Contents/Frameworks/Chromium Framework.framework/Versions/145/marker",
            "framework",
            "Chromium.app",
          ],
        ],
        [],
      ),
    );

    await installBinary({
      archive,
      root,
      version: "145.0.0.0",
      pro: false,
      platform: "darwin-arm64",
      sha256: "archive-sha",
      source: "official",
      trust: "verified",
    });

    const destination = join(
      root,
      "browser-runtime/browsers/darwin-arm64-145.0.0.0",
    );
    await expect(
      readFile(
        join(
          destination,
          "Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/145/marker",
        ),
        "utf8",
      ),
    ).resolves.toBe("framework");
    await expect(lstat(join(destination, "Contents"))).rejects.toThrow();
  });
});
