import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SafeZipArchive } from "../../src/core/archive/index.js";

export class TestCoordinatorArchive extends SafeZipArchive {
  readonly extracted: string[] = [];
  failCachedExtraction = false;
  failDownloadedExtraction = false;

  override async extractAtomic(
    source: string,
    destination: string,
  ): Promise<void> {
    this.extracted.push(source);
    if (
      (source.endsWith("cached.zip") && this.failCachedExtraction) ||
      (!source.endsWith("cached.zip") && this.failDownloadedExtraction)
    )
      throw new Error("malformed ZIP");
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await writeFile(join(destination, "profile.txt"), "restored");
  }

  override async create(_source: string, destination: string) {
    const bytes = Buffer.from("uploaded-archive");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes);
    return {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      format: "zip" as const,
    };
  }

  override async verifyIdentity(
    source: string,
    expected: { size: number; sha256: string; format: "zip" },
  ) {
    const bytes = await readFile(source);
    const actual = {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      format: "zip" as const,
    };
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256)
      throw new Error("archive identity mismatch");
    return actual;
  }
}
