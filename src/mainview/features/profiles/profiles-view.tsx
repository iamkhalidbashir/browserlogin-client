import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBridge } from "../../rpc-client.js";
import {
  ProfileTable,
  type ProfileAction,
} from "./profile-table.js";
import { ForceStopConfirmation } from "./force-stop-confirmation.js";
import DashboardView from "../launch/dashboard-view.js";

type ProfileForm = {
  name: string;
  seed: number;
  proxy_id: string | null;
  platform: "macos" | "windows" | "linux";
  geoip: boolean;
  humanize: boolean;
  human_preset: "default" | "careful";
  bumblebee_profile: "default" | "precise" | "fast" | "natural" | "messy";
  headless: boolean;
  timezone: string;
  locale: string;
  user_agent: string;
  viewport: { width: number; height: number };
  args: string[];
};

const defaults: ProfileForm = {
  name: "",
  seed: 42,
  proxy_id: null as string | null,
  platform: "macos" as const,
  geoip: true,
  humanize: true,
  human_preset: "careful" as const,
  bumblebee_profile: "natural" as const,
  headless: false,
  timezone: "America/Los_Angeles",
  locale: "en-US",
  user_agent: "",
  viewport: { width: 1440, height: 900 },
  args: [] as string[],
};

export default function ProfilesView() {
  const bridge = useBridge();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>(defaults);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [forceStopTargetId, setForceStopTargetId] = useState<string | null>(null);
  const [forceStopText, setForceStopText] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pendingActions, setPendingActions] = useState<
    Record<string, ProfileAction>
  >({});
  const protectedArg = form.args.find((value) =>
    /^--(?:fingerprint|user-data-dir|remote-debugging)/.test(value),
  );
  const profiles = useQuery({
    queryKey: ["profiles"],
    refetchInterval: 2_000,
    queryFn: async () => {
      const result = await bridge.request("profilesList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const proxies = useQuery({
    queryKey: ["proxies"],
    queryFn: async () => {
      const result = await bridge.request("proxiesList", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const deleteTarget = profiles.data?.find(
    (profile) => profile.id === deleteTargetId,
  );
  const forceStopTarget = profiles.data?.find(
    (profile) => profile.id === forceStopTargetId,
  );
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
      const result = await bridge.request("profilesUpdate", {
        ...form,
        profileId: editingId,
        expectedConfigVersion: Number(current?.cloud.config_version ?? 0),
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
  const launch = async (ids: string[]) => {
    setPendingActions((current) => ({
      ...current,
      ...Object.fromEntries(ids.map((id) => [id, "launch" as const])),
    }));
    try {
      const binary = await bridge.request("binaryStatus", {});
      if (!binary.ok || binary.value === null) return;
      for (const profileId of ids) {
        const result = await bridge.request("sessionsStart", { profileId });
        if (!result.ok) return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      ]);
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        for (const id of ids) delete next[id];
        return next;
      });
    }
  };
  const stopProfile = async (profileId: string) => {
    setPendingActions((current) => ({ ...current, [profileId]: "stop" }));
    try {
      const result = await bridge.request("sessionsStop", { profileId });
      if (result.ok)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profiles"] }),
          queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        ]);
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
    }
  };
  const forceStopProfile = async () => {
    if (!forceStopTarget) return;
    const profileId = forceStopTarget.id;
    setPendingActions((current) => ({
      ...current,
      [profileId]: "force-stop",
    }));
    try {
      const result = await bridge.request("sessionsForceStop", {
        profileId,
        confirmation: forceStopText,
      });
      if (result.ok) {
        setForceStopTargetId(null);
        setForceStopText("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["profiles"] }),
          queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        ]);
      }
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
    }
  };
  const editProfile = (profileId: string) => {
    const current = profiles.data?.find((profile) => profile.id === profileId);
    if (!current) return;
    setForm({
      ...defaults,
      name: current.name,
      seed: current.seed,
      proxy_id: current.proxy?.id ?? null,
      platform:
        current.platform === "windows" || current.platform === "linux"
          ? current.platform
          : "macos",
      geoip: current.geoip,
      humanize: current.humanize,
      human_preset: current.human_preset,
      bumblebee_profile: current.bumblebee_profile,
      headless: current.headless,
      timezone: current.timezone ?? "",
      locale: current.locale ?? "",
      user_agent: current.user_agent ?? "",
      viewport: current.viewport as { width: number; height: number },
      args: current.args,
    });
    setEditingId(current.id);
    setEditor("edit");
  };
  const deleteProfile = async () => {
    if (!deleteTarget) return;
    setPendingActions((current) => ({
      ...current,
      [deleteTarget.id]: "delete",
    }));
    try {
      const result = await bridge.request("profilesDelete", {
        profileId: deleteTarget.id,
      });
      if (result.ok) {
        setDeleteTargetId(null);
        setDeleteText("");
        await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      }
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[deleteTarget.id];
        return next;
      });
    }
  };
  const restoreProfile = async (profileId: string) => {
    setPendingActions((current) => ({
      ...current,
      [profileId]: "restore",
    }));
    try {
      const result = await bridge.request("profilesRestore", { profileId });
      if (result.ok)
        await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
    }
  };
  const rotateProfileProxy = async (profileId: string) => {
    const profile = profiles.data?.find((candidate) => candidate.id === profileId);
    if (!profile?.proxy) return;
    setPendingActions((current) => ({
      ...current,
      [profileId]: "rotate",
    }));
    try {
      await bridge.request("proxiesChangeIp", {
        proxyId: profile.proxy.id,
      });
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["proxies"] });
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
    }
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
            setForm(defaults);
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
        onStop={(profileId) => void stopProfile(profileId)}
        onForceStop={(profileId) => {
          setForceStopTargetId(profileId);
          setForceStopText("");
        }}
        onEdit={editProfile}
        onRestore={(profileId) => void restoreProfile(profileId)}
        onRotate={(profileId) => void rotateProfileProxy(profileId)}
        onDelete={(profileId) => {
          setDeleteTargetId(profileId);
          setDeleteText("");
        }}
      />
      <div className="mt-8">
        <DashboardView title="Sessions" />
      </div>
      {forceStopTarget ? (
        <ForceStopConfirmation
          profileId={forceStopTarget.id}
          confirmation={forceStopText}
          pending={pendingActions[forceStopTarget.id] === "force-stop"}
          onConfirmationChange={setForceStopText}
          onConfirm={() => void forceStopProfile()}
        />
      ) : null}
      {deleteTarget ? (
        <div className="panel mt-4">
          <h3 className="font-medium">Delete profile</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Type <strong>{deleteTarget.name}</strong> to confirm.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              className="input"
              aria-label="Delete confirmation"
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
            />
            <button
              className="button-danger"
              disabled={
                deleteText !== deleteTarget.name ||
                pendingActions[deleteTarget.id] === "delete"
              }
              onClick={() => void deleteProfile()}
            >
              {pendingActions[deleteTarget.id] === "delete"
                ? "Deleting…"
                : "Delete"}
            </button>
          </div>
        </div>
      ) : null}
      {editor ? (
        <div
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`${editor === "create" ? "Create" : "Edit"} profile`}
        >
          <div className="drawer-card">
            <div className="flex justify-between">
              <h3 className="text-xl font-semibold">
                {editor === "create" ? "Create profile" : "Edit profile"}
              </h3>
              <button className="table-action" onClick={() => setEditor(null)}>
                Close
              </button>
            </div>
            <div className="form-grid mt-5">
              <label className="field">
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Seed</span>
                <input
                  type="number"
                  value={form.seed}
                  onChange={(event) =>
                    setForm({ ...form, seed: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Platform</span>
                <select
                  value={form.platform}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      platform: event.target.value as typeof form.platform,
                    })
                  }
                >
                  <option value="macos">macOS</option>
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </label>
              <label className="field">
                <span>Proxy</span>
                <select
                  value={form.proxy_id ?? ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      proxy_id: event.target.value || null,
                    })
                  }
                >
                  <option value="">Direct</option>
                  {proxies.data?.map((proxy) => (
                    <option key={proxy.id} value={proxy.id}>
                      {proxy.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Human preset</span>
                <select
                  value={form.human_preset}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      human_preset: event.target
                        .value as typeof form.human_preset,
                    })
                  }
                >
                  <option value="careful">Careful</option>
                  <option value="default">Default</option>
                </select>
              </label>
              <label className="field">
                <span>Bumblebee profile</span>
                <select
                  value={form.bumblebee_profile}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bumblebee_profile: event.target
                        .value as typeof form.bumblebee_profile,
                    })
                  }
                >
                  {["natural", "default", "precise", "fast", "messy"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                <span>Timezone</span>
                <input
                  value={form.timezone}
                  onChange={(event) =>
                    setForm({ ...form, timezone: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Locale</span>
                <input
                  value={form.locale}
                  onChange={(event) =>
                    setForm({ ...form, locale: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>User agent</span>
                <input
                  value={form.user_agent}
                  onChange={(event) =>
                    setForm({ ...form, user_agent: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Viewport width</span>
                <input
                  type="number"
                  value={form.viewport.width}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      viewport: {
                        ...form.viewport,
                        width: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Viewport height</span>
                <input
                  type="number"
                  value={form.viewport.height}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      viewport: {
                        ...form.viewport,
                        height: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="field col-span-2">
                <span>Browser arguments</span>
                <input
                  aria-label="Browser arguments"
                  placeholder="--disable-features=Example"
                  value={form.args.join(" ")}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      args: event.target.value
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 256),
                    })
                  }
                />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.geoip}
                  onChange={(event) =>
                    setForm({ ...form, geoip: event.target.checked })
                  }
                />
                GeoIP
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.humanize}
                  onChange={(event) =>
                    setForm({ ...form, humanize: event.target.checked })
                  }
                />
                Humanize input
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.headless}
                  onChange={(event) =>
                    setForm({ ...form, headless: event.target.checked })
                  }
                />
                Headless
              </label>
            </div>
            {protectedArg ? (
              <div className="conflict-banner" role="alert">
                Protected argument is managed by BrowserLogin: {protectedArg}
              </div>
            ) : null}
            {conflict ? (
              <div className="conflict-banner" role="alert">
                Profile changed remotely.{" "}
                <button
                  onClick={() => {
                    setConflict(false);
                    void profiles.refetch();
                  }}
                >
                  Reload latest
                </button>
              </div>
            ) : null}
            <button
              className="button-primary mt-5"
              disabled={!form.name || save.isPending || Boolean(protectedArg)}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
