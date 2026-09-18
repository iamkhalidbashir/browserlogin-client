import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAttentionSettings } from "../../src/core/app/settings.js";

const roots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-settings-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("attention settings", () => {
  it("reads disabled defaults without a keychain backend", async () => {
    // Given
    const root = await freshRoot();

    // When
    const settings = await readAttentionSettings(root);

    // Then
    expect(settings).toEqual({
      attention_enabled: false,
      attention_delivery: "both",
      attention_sound: "default",
    });
  });

  it("reads persisted attention preferences without a keychain backend", async () => {
    // Given
    const root = await freshRoot();
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        attention_enabled: true,
        attention_delivery: "notification",
        attention_sound: "subtle",
      }),
      { mode: 0o600 },
    );

    // When
    const settings = await readAttentionSettings(root);

    // Then
    expect(settings).toEqual({
      attention_enabled: true,
      attention_delivery: "notification",
      attention_sound: "subtle",
    });
  });
});
