import { ModalDialog } from "../../components/modal-dialog.js";

type ProfileDeleteConfirmationProps = {
  readonly profileName: string;
  readonly confirmation: string;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onConfirmationChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
};

export function ProfileDeleteConfirmation({
  profileName,
  confirmation,
  error,
  pending,
  onConfirmationChange,
  onClose,
  onConfirm,
}: ProfileDeleteConfirmationProps) {
  return (
    <ModalDialog
      title="Delete profile"
      description={
        <p>
          Type <strong>{profileName}</strong> to confirm.
        </p>
      }
      onClose={onClose}
    >
      <label className="field">
        <span>Profile name</span>
        <input
          data-modal-autofocus
          aria-label="Delete confirmation"
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </label>
      {error ? (
        <div className="conflict-banner mt-4" role="alert">
          {error}
        </div>
      ) : null}
      <button
        className="button-danger mt-4"
        disabled={confirmation !== profileName || pending}
        onClick={onConfirm}
      >
        {pending ? "Deleting…" : "Delete profile"}
      </button>
    </ModalDialog>
  );
}
