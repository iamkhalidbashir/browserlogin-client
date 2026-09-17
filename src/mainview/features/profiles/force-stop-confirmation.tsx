import { ModalDialog } from "../../components/modal-dialog.js";

type ForceStopConfirmationProps = {
  readonly profileId: string;
  readonly confirmation: string;
  readonly pending: boolean;
  readonly onConfirmationChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
};

export function ForceStopConfirmation({
  profileId,
  confirmation,
  pending,
  onConfirmationChange,
  onClose,
  onConfirm,
}: ForceStopConfirmationProps) {
  const expected = `FORCE CLOSE ${profileId}`;
  return (
    <ModalDialog
      title="Force stop profile"
      description={
        <p>
          This discards uncommitted local browser changes and uploads no
          archive. Type <strong>{expected}</strong> to confirm.
        </p>
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <input
          className="input"
          data-modal-autofocus
          aria-label={`Force confirmation ${profileId}`}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
        <button
          className="button-danger"
          aria-label={`Force stop ${profileId}`}
          disabled={confirmation !== expected || pending}
          onClick={onConfirm}
        >
          {pending ? "Force stopping…" : "Force stop"}
        </button>
      </div>
    </ModalDialog>
  );
}
