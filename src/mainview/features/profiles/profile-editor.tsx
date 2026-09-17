import { ModalDialog } from "../../components/modal-dialog.js";
import type { BridgeResult } from "../../rpc-client.js";
import type { ProfileForm } from "./profile-form.js";

type ProfileEditorProps = {
  readonly mode: "create" | "edit";
  readonly form: ProfileForm;
  readonly proxies: BridgeResult<"proxiesList"> | undefined;
  readonly protectedArg: string | undefined;
  readonly conflict: boolean;
  readonly saving: boolean;
  readonly onChange: (form: ProfileForm) => void;
  readonly onClose: () => void;
  readonly onReload: () => void;
  readonly onSave: () => void;
};

export function ProfileEditor({
  mode,
  form,
  proxies,
  protectedArg,
  conflict,
  saving,
  onChange,
  onClose,
  onReload,
  onSave,
}: ProfileEditorProps) {
  return (
    <ModalDialog
      title={mode === "create" ? "Create profile" : "Edit profile"}
      size="wide"
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input
            data-modal-autofocus
            value={form.name}
            onChange={(event) =>
              onChange({ ...form, name: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Seed</span>
          <input
            type="number"
            value={form.seed}
            onChange={(event) =>
              onChange({ ...form, seed: Number(event.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Platform</span>
          <select
            value={form.platform}
            onChange={(event) =>
              onChange({
                ...form,
                platform: event.target.value as ProfileForm["platform"],
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
              onChange({ ...form, proxy_id: event.target.value || null })
            }
          >
            <option value="">Direct</option>
            {proxies?.map((proxy) => (
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
              onChange({
                ...form,
                human_preset: event.target.value as ProfileForm["human_preset"],
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
              onChange({
                ...form,
                bumblebee_profile: event.target
                  .value as ProfileForm["bumblebee_profile"],
              })
            }
          >
            {(["natural", "default", "precise", "fast", "messy"] as const).map(
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
              onChange({ ...form, timezone: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Locale</span>
          <input
            value={form.locale}
            onChange={(event) =>
              onChange({ ...form, locale: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>User agent</span>
          <input
            value={form.user_agent}
            onChange={(event) =>
              onChange({ ...form, user_agent: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Viewport width</span>
          <input
            type="number"
            value={form.viewport.width}
            onChange={(event) =>
              onChange({
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
              onChange({
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
              onChange({
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
              onChange({ ...form, geoip: event.target.checked })
            }
          />
          GeoIP
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={form.humanize}
            onChange={(event) =>
              onChange({ ...form, humanize: event.target.checked })
            }
          />
          Humanize input
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={form.headless}
            onChange={(event) =>
              onChange({ ...form, headless: event.target.checked })
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
          <button onClick={onReload}>Reload latest</button>
        </div>
      ) : null}
      <button
        className="button-primary mt-5"
        disabled={!form.name || saving || Boolean(protectedArg)}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </ModalDialog>
  );
}
