import type { BridgeResult } from "../../rpc-client.js";

export type ProfileAction = "launch" | "stop" | "restore" | "rotate" | "delete";
type Profile = BridgeResult<"profilesList">[number];

type ProfileTableProps = {
  readonly profiles: readonly Profile[];
  readonly selected: readonly string[];
  readonly pendingActions: Readonly<Record<string, ProfileAction>>;
  readonly onSelectionChange: (profileId: string, selected: boolean) => void;
  readonly onLaunch: (profileId: string) => void;
  readonly onStop: (profileId: string) => void;
  readonly onEdit: (profileId: string) => void;
  readonly onRestore: (profileId: string) => void;
  readonly onRotate: (profileId: string) => void;
  readonly onDelete: (profileId: string) => void;
};

export function ProfileTable({
  profiles,
  selected,
  pendingActions,
  onSelectionChange,
  onLaunch,
  onStop,
  onEdit,
  onRestore,
  onRotate,
  onDelete,
}: ProfileTableProps) {
  return (
    <div className="panel mt-4 overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Platform</th>
            <th>Proxy</th>
            <th>Archive</th>
            <th>Cloud session</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const pendingAction = pendingActions[profile.id];
            const rowPending = pendingAction !== undefined;
            return (
              <tr key={profile.id} aria-busy={rowPending}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${profile.name}`}
                    checked={selected.includes(profile.id)}
                    disabled={rowPending}
                    onChange={(event) =>
                      onSelectionChange(profile.id, event.target.checked)
                    }
                  />
                </td>
                <td>{profile.name}</td>
                <td>{profile.platform}</td>
                <td>{profile.proxy?.name ?? "Direct"}</td>
                <td>{String(profile.cloud.archive_generation ?? 0)}</td>
                <td>
                  {profile.cloud.current_session_id ? "Running" : "Stopped"}
                </td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {profile.cloud.current_session_id ? (
                      <button
                        className="table-action"
                        disabled={rowPending}
                        onClick={() => onStop(profile.id)}
                      >
                        {pendingAction === "stop"
                          ? "Stopping…"
                          : "Stop and archive"}
                      </button>
                    ) : (
                      <button
                        className="table-action"
                        disabled={rowPending}
                        onClick={() => onLaunch(profile.id)}
                      >
                        {pendingAction === "launch" ? "Launching…" : "Launch"}
                      </button>
                    )}
                    {profile.proxy ? (
                      <button
                        className="table-action"
                        disabled={rowPending || !profile.proxy.change_ip_url}
                        title={
                          profile.proxy.change_ip_url
                            ? undefined
                            : "This proxy does not provide IP rotation"
                        }
                        onClick={() => onRotate(profile.id)}
                      >
                        {pendingAction === "rotate" ? "Rotating…" : "Rotate IP"}
                      </button>
                    ) : null}
                    <button
                      className="table-action"
                      disabled={rowPending}
                      onClick={() => onEdit(profile.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="table-action"
                      disabled={rowPending}
                      onClick={() => onRestore(profile.id)}
                    >
                      {pendingAction === "restore" ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      className="table-action table-action-danger"
                      disabled={rowPending}
                      aria-label={`Delete ${profile.name}`}
                      onClick={() => onDelete(profile.id)}
                    >
                      {pendingAction === "delete" ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
