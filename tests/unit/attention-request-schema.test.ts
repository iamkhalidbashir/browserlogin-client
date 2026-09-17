import { describe, expect, it } from "vitest";
import { AttentionRequestSchema } from "../../src/core/attention/index.js";

describe("attention request schema", () => {
  it("defaults the optional title and rejects unknown properties", () => {
    // Given
    const request = { message: "Continue the sign-in flow." };

    // When
    const parsed = AttentionRequestSchema.parse(request);
    const unknownProperty = AttentionRequestSchema.safeParse({
      ...request,
      content: "not allowed",
    });

    // Then
    expect(parsed).toEqual({
      title: "BrowserLogin",
      message: request.message,
    });
    expect(unknownProperty.success).toBe(false);
  });

  it.each([
    [{ title: "", message: "valid" }],
    [{ title: "x".repeat(81), message: "valid" }],
    [{ message: "" }],
    [{ message: "x".repeat(501) }],
  ])("rejects out-of-range attention text %#", (request) => {
    // Given / When
    const parsed = AttentionRequestSchema.safeParse(request);

    // Then
    expect(parsed.success).toBe(false);
  });
});
