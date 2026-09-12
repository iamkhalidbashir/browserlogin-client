import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { safeErrorMessage } from "../../../shared/redaction.js";

const ACTIVE_STATUS_QUERY_KEYS = [
  ["connection"],
  ["binary"],
  ["profiles"],
  ["sessions"],
] as const;

type RefreshFeedback =
  | {
      readonly state: "pending" | "success";
      readonly role: "status";
      readonly message: string;
    }
  | {
      readonly state: "error";
      readonly role: "alert";
      readonly message: string;
    };

export function StatusRefresh() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<RefreshFeedback | null>(null);

  useEffect(() => {
    if (!feedback || feedback.state === "pending") return;
    const timer = window.setTimeout(() => setFeedback(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const refresh = async () => {
    setFeedback(null);
    setFeedback({
      state: "pending",
      role: "status",
      message: "Refreshing connection, runtime, profiles, and live sessions…",
    });
    try {
      await Promise.all(
        ACTIVE_STATUS_QUERY_KEYS.map((queryKey) =>
          queryClient.refetchQueries(
            { queryKey, type: "active", exact: true },
            { throwOnError: true },
          ),
        ),
      );
      setFeedback({
        state: "success",
        role: "status",
        message:
          "Connection, runtime, remote profiles, and live sessions are up to date.",
      });
    } catch (error) {
      setFeedback({
        state: "error",
        role: "alert",
        message: `Status refresh failed: ${safeErrorMessage(error instanceof Error ? error : "Status refresh request failed.")} Check the connection and try again.`,
      });
    }
  };

  const pending = feedback?.state === "pending";
  return (
    <>
      <button
        className="button-secondary"
        disabled={pending}
        onClick={() => void refresh()}
      >
        {pending ? "Refreshing" : "Refresh status"}
      </button>
      {feedback ? (
        <div
          className="toast"
          role={feedback.role}
          aria-label="Status notification"
          aria-live={feedback.role === "alert" ? "assertive" : "polite"}
          data-state={feedback.state}
        >
          <span>{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
