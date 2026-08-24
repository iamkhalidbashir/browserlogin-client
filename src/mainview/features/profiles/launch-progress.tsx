import { useRef, useState } from "react";

const LAUNCH_STAGES = [
  { id: "checking-runtime", label: "Checking browser runtime" },
  { id: "starting-session", label: "Starting remote session and browser" },
  { id: "ui-cache-refresh", label: "Refreshing session views" },
] as const;

type LaunchStageId = (typeof LAUNCH_STAGES)[number]["id"];

type LaunchProgress = {
  readonly active: LaunchStageId | null;
  readonly durations: Readonly<Partial<Record<LaunchStageId, number>>>;
  readonly totalMs: number | null;
};

const INITIAL_PROGRESS: LaunchProgress = {
  active: null,
  durations: {},
  totalMs: null,
};

export function useLaunchProgress() {
  const [progress, setProgress] = useState<LaunchProgress>(INITIAL_PROGRESS);
  const startedAt = useRef<number | null>(null);
  const stageStartedAt = useRef<number | null>(null);
  const active = useRef<LaunchStageId | null>(null);

  const begin = () => {
    const now = performance.now();
    startedAt.current = now;
    stageStartedAt.current = now;
    active.current = "checking-runtime";
    setProgress({ active: active.current, durations: {}, totalMs: null });
  };

  const advance = (next: LaunchStageId) => {
    const current = active.current;
    const currentStartedAt = stageStartedAt.current;
    if (current === null || currentStartedAt === null) return;
    const now = performance.now();
    active.current = next;
    stageStartedAt.current = now;
    setProgress((value) => ({
      ...value,
      active: next,
      durations: {
        ...value.durations,
        [current]: Math.round(now - currentStartedAt),
      },
    }));
  };

  const finish = () => {
    const current = active.current;
    const currentStartedAt = stageStartedAt.current;
    const launchStartedAt = startedAt.current;
    if (
      current === null ||
      currentStartedAt === null ||
      launchStartedAt === null
    )
      return;
    const now = performance.now();
    active.current = null;
    stageStartedAt.current = null;
    setProgress((value) => ({
      active: null,
      durations: {
        ...value.durations,
        [current]: Math.round(now - currentStartedAt),
      },
      totalMs: Math.round(now - launchStartedAt),
    }));
  };

  return { progress, begin, advance, finish };
}

export function LaunchProgressView({
  progress,
}: {
  readonly progress: LaunchProgress;
}) {
  return (
    <ol className="mt-3 grid gap-2" aria-label="Launch stages">
      {LAUNCH_STAGES.map((stage) => {
        const duration = progress.durations[stage.id];
        const state =
          progress.active === stage.id
            ? "In progress"
            : duration === undefined
              ? "Pending"
              : `${duration} ms`;
        return (
          <li
            className="flex justify-between gap-4 text-sm"
            data-launch-stage={stage.id}
            key={stage.id}
          >
            <span>{stage.label}</span>
            <span className="text-zinc-500">{state}</span>
          </li>
        );
      })}
      {progress.totalMs === null ? null : (
        <li className="flex justify-between gap-4 border-t border-zinc-200 pt-2 text-sm font-medium">
          <span>Total</span>
          <span>{progress.totalMs} ms</span>
        </li>
      )}
    </ol>
  );
}
