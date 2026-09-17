import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ModalDialog } from "../../src/mainview/components/modal-dialog.js";
import { ForceStopConfirmation } from "../../src/mainview/features/profiles/force-stop-confirmation.js";

describe("ModalDialog", () => {
  test("renders a labelled modal on a fixed overlay", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ModalDialog,
        { title: "Delete profile", onClose: () => undefined },
        createElement("input", { "aria-label": "Delete confirmation" }),
      ),
    );

    expect(markup).toContain('class="modal-overlay"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="');
    expect(markup).toContain("Delete profile");
    expect(markup).toContain('aria-label="Close Delete profile"');
  });

  test("keeps force-stop input inside the modal", () => {
    const markup = renderToStaticMarkup(
      createElement(ForceStopConfirmation, {
        profileId: "profile-1",
        confirmation: "",
        pending: false,
        onConfirmationChange: () => undefined,
        onClose: () => undefined,
        onConfirm: () => undefined,
      }),
    );

    expect(markup).toContain('class="modal-overlay"');
    expect(markup).toContain('aria-label="Force confirmation profile-1"');
    expect(markup).toContain("FORCE CLOSE profile-1");
  });
});
