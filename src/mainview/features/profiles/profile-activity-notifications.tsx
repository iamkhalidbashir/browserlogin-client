import type { BridgeResult } from "../../rpc-client.js";
import type { ProfileAction } from "./profile-table.js";
import type {
  ProfileLifecycleFailure,
  ProfileLifecycleFailures,
} from "./use-profile-actions.js";
import {
  transferPresentation,
  type ProfileTransferProgress,
  type TransferPresentation,
} from "./use-profile-transfer-progress.js";

type Profile = BridgeResult<"profilesList">[number];

type ProfileActivityPresentation = Omit<
  TransferPresentation,
  "percentage"
> & {
  readonly percentage?: number;
};

type ProfileActivity = Readonly<{
  profile: Profile;
  progress: ProfileActivityPresentation | null;
  failure: ProfileLifecycleFailure | undefined;
}>;

type ProfileActivityNotificationsProps = {
  readonly profiles: readonly Profile[];
  readonly pendingActions: Readonly<Record<string, ProfileAction>>;
  readonly transferProgress: ProfileTransferProgress;
  readonly failures: ProfileLifecycleFailures;
};

function failureLabel(failure: ProfileLifecycleFailure): string {
  const action = failure.action === "stop" ? "Stop" : "Force close";
  return `${action} failed (${failure.code}): ${failure.message}`;
}

function activityPresentation(
  profileName: string,
  pendingAction: ProfileAction | undefined,
  progress: ProfileTransferProgress[string] | undefined,
): ProfileActivityPresentation | null {
  const transfer = transferPresentation(profileName, pendingAction, progress);
  if (transfer) return transfer;
  if (pendingAction === "launch")
    return {
      label: "Launching…",
      accessibleName: `${profileName} launch progress`,
      valueText: "Preparing profile launch",
      state: "running",
    };
  if (pendingAction === "stop")
    return {
      label: "Preparing archive…",
      accessibleName: `${profileName} stop progress`,
      valueText: "Preparing profile archive for upload",
      state: "running",
    };
  return null;
}

export function ProfileActivityNotifications({
  profiles,
  pendingActions,
  transferProgress,
  failures,
}: ProfileActivityNotificationsProps) {
  const activities: readonly ProfileActivity[] = profiles.flatMap((profile) => {
    const progress = activityPresentation(
      profile.name,
      pendingActions[profile.id],
      transferProgress[profile.id],
    );
    const failure = failures[profile.id];
    return progress || failure ? [{ profile, progress, failure }] : [];
  });

  if (activities.length === 0) return null;

  return (
    <aside className="profile-activity-stack" aria-label="Profile activity">
      {activities.map(({ profile, progress, failure }) => (
        <article
          className="profile-activity-card"
          data-state={failure ? "failed" : progress?.state}
          key={profile.id}
        >
          <strong>{profile.name}</strong>
          {progress ? (
            <div
              className="profile-transfer-progress"
              data-state={progress.state}
            >
              <span>{progress.label}</span>
              <progress
                className="runtime-progress"
                max={100}
                value={progress.percentage}
                aria-label={progress.accessibleName}
                aria-valuetext={progress.valueText}
              />
            </div>
          ) : null}
          {failure ? (
            <p className="profile-activity-error" role="alert">
              {failureLabel(failure)}
            </p>
          ) : null}
        </article>
      ))}
    </aside>
  );
}
