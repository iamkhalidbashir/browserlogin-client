import type { BridgeResult } from "../../rpc-client.js";

export type ProfileAction =
  "launch" | "stop" | "force-stop" | "rotate" | "delete";
type Profile = BridgeResult<"profilesList">[number];

type ProfileTableProps = {
  readonly profiles: readonly Profile[];
  readonly workspaceOwner: boolean;
  readonly selected: readonly string[];
  readonly pendingActions: Readonly<Record<string, ProfileAction>>;
  readonly onSelectionChange: (profileId: string, selected: boolean) => void;
  readonly onLaunch: (profileId: string) => void;
  readonly onStop: (profileId: string) => void;
  readonly onForceStop: (profileId: string) => void;
  readonly onEdit: (profileId: string) => void;
  readonly onRotate: (profileId: string) => void;
  readonly onDelete: (profileId: string) => void;
};

export function ProfileTable({
  profiles,
  workspaceOwner,
  selected,
  pendingActions,
  onSelectionChange,
  onLaunch,
  onStop,
  onForceStop,
  onEdit,
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
            const canOperate =
              workspaceOwner ||
              profile.cloud.role === "owner" ||
              profile.cloud.role === "editor";
            const canManage = workspaceOwner || profile.cloud.role === "owner";
            return (
              <tr key={profile.id} aria-busy={rowPending}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${profile.name}`}
                    checked={selected.includes(profile.id)}
                    disabled={rowPending || !canOperate}
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
                    {profile.cloud.current_session_id && canOperate ? (
                      <>
                        <button
                          className="table-action"
                          disabled={rowPending}
                          onClick={() => onStop(profile.id)}
                        >
                          {pendingAction === "stop" ? "Stopping…" : "Stop"}
                        </button>
                        {canManage ? (
                          <button
                            className="table-action table-action-danger"
                            disabled={rowPending}
                            onClick={() => onForceStop(profile.id)}
                          >
                            {pendingAction === "force-stop"
                              ? "Force stopping…"
                              : "Force stop"}
                          </button>
                        ) : null}
                      </>
                    ) : !profile.cloud.current_session_id && canOperate ? (
                      <button
                        className="table-action"
                        disabled={rowPending}
                        onClick={() => onLaunch(profile.id)}
                      >
                        {pendingAction === "launch" ? "Launching…" : "Launch"}
                      </button>
                    ) : null}
                    {profile.proxy && canManage ? (
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
                    {canOperate ? (
                      <button
                        className="table-action"
                        disabled={rowPending}
                        onClick={() => onEdit(profile.id)}
                      >
                        Edit
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        className="table-action table-action-danger"
                        disabled={rowPending}
                        aria-label={`Delete ${profile.name}`}
                        onClick={() => onDelete(profile.id)}
                      >
                        {pendingAction === "delete" ? "Deleting…" : "Delete"}
                      </button>
                    ) : null}
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
