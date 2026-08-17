export const QUIT_CHOICES = ["stop", "force-stop", "leave-running"] as const;
export type QuitChoice = (typeof QUIT_CHOICES)[number];

export type QuitDecision = {
  choice: QuitChoice;
  liveSessionIds: string[];
};

export function decideQuitWithLiveSessions(
  liveSessionIds: readonly string[],
  choice: QuitChoice = "leave-running",
): QuitDecision {
  if (!QUIT_CHOICES.includes(choice))
    throw new TypeError("invalid quit choice");
  return { choice, liveSessionIds: [...liveSessionIds] };
}

export async function applyQuitDecision(
  decision: QuitDecision,
  actions: {
    stop: (profileId: string) => Promise<unknown>;
    forceStop: (profileId: string) => Promise<unknown>;
  },
): Promise<void> {
  if (decision.choice === "leave-running") return;
  const action = decision.choice === "stop" ? actions.stop : actions.forceStop;
  await Promise.all(
    decision.liveSessionIds.map((profileId) => action(profileId)),
  );
}
