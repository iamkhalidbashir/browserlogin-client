import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/shared/version";

describe("package version", () => {
  it("exposes the scaffold release version", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
