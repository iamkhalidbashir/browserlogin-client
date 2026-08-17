import { lazy, Suspense, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useBridge } from "./rpc-client.js";

const Dashboard = lazy(() => import("./routes/dashboard.js"));
const Profiles = lazy(() => import("./routes/profiles.js"));
const Proxies = lazy(() => import("./routes/proxies.js"));
const Users = lazy(() => import("./routes/users.js"));
const Audit = lazy(() => import("./routes/audit.js"));
const Sessions = lazy(() => import("./routes/sessions.js"));
const Settings = lazy(() => import("./routes/settings.js"));

const routes = [
  ["/dashboard", "Dashboard"],
  ["/profiles", "Profiles"],
  ["/proxies", "Proxies"],
  ["/users", "Users"],
  ["/audit", "Audit"],
  ["/sessions", "Sessions"],
  ["/settings", "Settings"],
] as const;

export function App() {
  const bridge = useBridge();
  const [toast, setToast] = useState<string | null>(null);
  const connection = useQuery({
    queryKey: ["connection"],
    queryFn: async () => {
      const result = await bridge.request("connectionGet", {});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="grid min-h-screen grid-cols-[240px_1fr]">
        <aside
          className="border-r border-zinc-200 bg-white/80 p-5 dark:border-zinc-800 dark:bg-zinc-900/80"
          aria-label="Primary navigation"
        >
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
              BrowserLogin
            </p>
            <h1 className="mt-2 text-xl font-semibold">Control center</h1>
          </div>
          <nav className="space-y-1">
            {routes.map(([path, label]) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "nav-link-active" : ""}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <header className="flex h-16 items-center justify-between border-b border-zinc-200 px-7 dark:border-zinc-800">
            <div className="flex gap-2" aria-label="Application status">
              <span className="status-pill">
                {connection.isLoading
                  ? "Connecting"
                  : connection.data?.hasApiKey
                    ? "Connected"
                    : "Setup required"}
              </span>
              <span className="status-pill">Free</span>
              <span className="status-pill">Up to date</span>
            </div>
            <button
              className="button-secondary"
              onClick={() => setToast("Status refreshed")}
            >
              Refresh status
            </button>
          </header>
          <main id="main" className="p-7" tabIndex={-1}>
            <Suspense
              fallback={
                <div className="skeleton h-40" aria-label="Loading route" />
              }
            >
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/profiles" element={<Profiles />} />
                <Route path="/proxies" element={<Proxies />} />
                <Route path="/users" element={<Users />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/settings" element={<Settings />} />
                <Route
                  path="*"
                  element={<Navigate to="/dashboard" replace />}
                />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
      {toast ? (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
