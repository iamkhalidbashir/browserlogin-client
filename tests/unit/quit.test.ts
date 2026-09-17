import { describe, expect, test, vi } from "vitest";
import {
  applyQuitDecision,
  decideQuitWithLiveSessions,
} from "../../src/bun/quit.js";

describe("quit with live sessions", () => {
  test.each(["stop", "force-stop", "leave-running"] as const)(
    "supports %s",
    async (choice) => {
      const decision = decideQuitWithLiveSessions(["p1", "p2"], choice);
      const stop = vi.fn(async () => undefined);
      const forceStop = vi.fn(async () => undefined);
      await applyQuitDecision(decision, { stop, forceStop });
      expect(decision.choice).toBe(choice);
      expect(
        choice === "stop" ? stop : choice === "force-stop" ? forceStop : stop,
      ).toHaveBeenCalledTimes(choice === "leave-running" ? 0 : 2);
    },
  );

  test("defaults to leave-running", () => {
    expect(decideQuitWithLiveSessions(["p1"]).choice).toBe("leave-running");
  });
});
