import { expect, test } from "vitest";
import { normalizeToolResult } from "../../src/core/browser-tools/vendor-tools.js";

test("normalizes CloakBrowser's false dialog-closed protocol error", () => {
  // Given
  const result = {
    content: [
      {
        type: "text",
        text: "### Error\nError: Protocol error (Page.handleJavaScriptDialog): No dialog is showing",
      },
    ],
    isError: true,
  };

  // When
  const normalized = normalizeToolResult("browser_handle_dialog", result);

  // Then
  expect(normalized).toEqual({
    content: [{ type: "text", text: "### Result\nDialog handled." }],
    isError: false,
  });
});

test.each([
  ["browser_click", "No dialog is showing"],
  ["browser_handle_dialog", "Dialog handle failed"],
])("preserves unrelated vendor errors for %s", (name, message) => {
  // Given
  const result = {
    content: [{ type: "text", text: `### Error\nError: ${message}` }],
    isError: true,
  };

  // When
  const normalized = normalizeToolResult(name, result);

  // Then
  expect(normalized).toBe(result);
});
