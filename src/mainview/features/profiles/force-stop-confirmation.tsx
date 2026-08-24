type ForceStopConfirmationProps = {
  readonly profileId: string;
  readonly confirmation: string;
  readonly pending: boolean;
  readonly onConfirmationChange: (value: string) => void;
  readonly onConfirm: () => void;
};

export function ForceStopConfirmation({
  profileId,
  confirmation,
  pending,
  onConfirmationChange,
  onConfirm,
}: ForceStopConfirmationProps) {
  const expected = `FORCE CLOSE ${profileId}`;
  return (
    <div className="panel mt-4">
      <h3 className="font-medium">Force stop profile</h3>
      <p className="mt-1 text-sm text-zinc-500">
        This discards uncommitted local browser changes and uploads no archive.
        Type <strong>{expected}</strong> to confirm.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          className="input"
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
    </div>
  );
}
