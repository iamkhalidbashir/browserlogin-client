import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";
import { ProfileActivityNotifications } from "./profile-activity-notifications.js";
import { ProfileTable } from "./profile-table.js";
import { ProfileEditor } from "./profile-editor.js";
import {
  DEFAULT_PROFILE_FORM,
  isProtectedProfileArgument,
  profileViewportForUpdate,
  profileToForm,
  type ProfileForm,
} from "./profile-form.js";
import { ForceStopConfirmation } from "./force-stop-confirmation.js";
import { ProfileDeleteConfirmation } from "./profile-delete-confirmation.js";
import { useProfileActions } from "./use-profile-actions.js";
import { useProfileLaunch } from "./use-profile-launch.js";
import { useProfileTransferProgress } from "./use-profile-transfer-progress.js";
import DashboardView from "../launch/dashboard-view.js";

export default function ProfilesView() {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>(DEFAULT_PROFILE_FORM);
  const [selected, setSelected] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const protectedArg = form.args.find(isProtectedProfileArgument);
  const profiles = useQuery({
    queryKey: ["profiles"],
    refetchInterval: 2_000,
    queryFn: async () => {
      const result = await bridge.request("profilesList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const actions = useProfileActions(profiles.data);
  const { launch, launchActions, feedback } = useProfileLaunch(profiles.data);
  const pendingActions = useMemo(
    () => ({ ...actions.pendingActions, ...launchActions }),
    [actions.pendingActions, launchActions],
  );
  const transferProgress = useProfileTransferProgress(pendingActions);
  const proxies = useQuery({
    queryKey: ["proxies"],
    queryFn: async () => {
      const result = await bridge.request("proxiesList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const currentUser = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const result = await bridge.request("currentUser", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const visible = useMemo(
    () =>
      (profiles.data ?? [])
        .filter((profile) =>
          profile.name.toLowerCase().includes(filter.toLowerCase()),
        )
        .slice(0, 50),
    [profiles.data, filter],
  );
  const save = useMutation({
    mutationFn: async () => {
      setConflict(false);
      if (editor === "create") return bridge.request("profilesCreate", form);
      if (!editingId) throw new Error("No profile selected for editing");
      const current = profiles.data?.find(
        (profile) => profile.id === editingId,
      );
      if (!current)
        throw new Error("Profile selected for editing is unavailable");
      const result = await bridge.request("profilesUpdate", {
        ...form,
        viewport: profileViewportForUpdate(current.viewport, form.viewport),
        profileId: editingId,
        expectedConfigVersion: Number(current.cloud.config_version ?? 0),
      });
      if (!result.ok && result.error.code === "CONFLICT") setConflict(true);
      return result;
    },
    onSuccess: async (result) => {
      if (result.ok) {
        setEditor(null);
        await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      }
    },
  });
  const editProfile = (profileId: string) => {
    const current = profiles.data?.find((profile) => profile.id === profileId);
    if (!current) return;
    setForm(profileToForm(current));
    setEditingId(current.id);
    setEditor("edit");
  };
  const reloadProfile = async () => {
    if (!editingId) return;
    const result = await profiles.refetch();
    if (!result.isSuccess) return;
    const current = result.data?.find((profile) => profile.id === editingId);
    if (!current) return;
    setForm(profileToForm(current));
    setConflict(false);
  };
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2 className="text-3xl font-semibold">Dashboard</h2>
          <p className="mt-2 text-zinc-500">
            Create and launch isolated browser identities.
          </p>
        </div>
        <button
          className="button-primary"
          onClick={() => {
            setForm(DEFAULT_PROFILE_FORM);
            setEditor("create");
          }}
        >
          Create profile
        </button>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <input
          className="input max-w-sm"
          aria-label="Filter profiles"
          placeholder="Filter profiles"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button
          className="button-secondary"
          disabled={!selected.length}
          onClick={() => void launch(selected)}
        >
          Launch selected
        </button>
      </div>
      <ProfileTable
        profiles={visible}
        workspaceOwner={Boolean(currentUser.data?.owner)}
        selected={selected}
        pendingActions={pendingActions}
        onSelectionChange={(profileId, checked) =>
          setSelected(
            checked
              ? [...selected, profileId]
              : selected.filter((id) => id !== profileId),
          )
        }
        onLaunch={(profileId) => void launch([profileId])}
        onStop={(profileId) => void actions.stopProfile(profileId)}
        onForceStop={actions.openForceStop}
        onEdit={editProfile}
        onRotate={(profileId) => void actions.rotateProfileProxy(profileId)}
        onDelete={actions.openDelete}
      />
      <ProfileActivityNotifications
        profiles={profiles.data ?? []}
        pendingActions={pendingActions}
        transferProgress={transferProgress}
        failures={actions.lifecycleFailures}
      />
      {feedback ? (
        <div
          className={
            feedback.role === "alert" ? "conflict-banner" : "panel mt-4"
          }
          role={feedback.role}
          aria-live={feedback.role === "alert" ? "assertive" : "polite"}
          data-state={feedback.state}
          data-code={feedback.code}
          data-completed={feedback.completed}
        >
          {feedback.message}
        </div>
      ) : null}
      <div className="mt-8">
        <DashboardView title="Sessions" />
      </div>
      {actions.forceStopTarget ? (
        <ForceStopConfirmation
          profileId={actions.forceStopTarget.id}
          confirmation={actions.forceStopText}
          pending={
            actions.pendingActions[actions.forceStopTarget.id] === "force-stop"
          }
          onConfirmationChange={actions.setForceStopText}
          onClose={actions.closeForceStop}
          onConfirm={() => void actions.forceStopProfile()}
        />
      ) : null}
      {actions.deleteTarget ? (
        <ProfileDeleteConfirmation
          profileName={actions.deleteTarget.name}
          confirmation={actions.deleteText}
          error={actions.deleteError}
          pending={actions.pendingActions[actions.deleteTarget.id] === "delete"}
          onConfirmationChange={actions.setDeleteText}
          onClose={actions.closeDelete}
          onConfirm={() => void actions.deleteProfile()}
        />
      ) : null}
      {editor ? (
        <ProfileEditor
          mode={editor}
          form={form}
          proxies={proxies.data}
          protectedArg={protectedArg}
          conflict={conflict}
          saving={save.isPending}
          onChange={setForm}
          onClose={() => setEditor(null)}
          onReload={() => void reloadProfile()}
          onSave={() => save.mutate()}
        />
      ) : null}
    </section>
  );
}
