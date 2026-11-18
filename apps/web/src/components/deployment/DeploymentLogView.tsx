import type {
  DeploymentLogPage,
  DeploymentLogSource,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { deploymentEnvironment } from "~/state/deployments";
import { useAtomCommand } from "~/state/use-atom-command";
import { parseTimestampDate } from "~/timestampFormat";

import { PullRequestsUnavailableState } from "../pullRequest/PullRequestsUnavailableState";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { DeploymentLogGhost } from "./DeploymentDetailGhost";
import {
  deploymentLogsWithOlder,
  prependOlderDeploymentLogs,
  type OlderDeploymentLogs,
} from "./DeploymentLogView.logic";

const FOLLOW_SLACK_PX = 8;

const SOURCE_COPY = {
  build: { failed: "Could not load build logs", empty: "No build output yet." },
  runtime: {
    failed: "Could not load runtime logs",
    empty: "No runtime logs in the last 24 hours.",
  },
} as const satisfies Record<DeploymentLogSource, { failed: string; empty: string }>;

const LEVEL_CLASS_NAME = {
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
} as const;

/** Always eight characters, whatever the clock format elsewhere, so the gutter keeps one width. */
function logLineClock(at: string): string | null {
  const date = parseTimestampDate(at);
  if (date === null) return null;
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

interface DeploymentLogTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly hostname: string;
  readonly source: DeploymentLogSource;
}

function DeploymentLogLines({
  environmentId,
  projectId,
  hostname,
  source,
  page,
}: DeploymentLogTarget & { readonly page: DeploymentLogPage }) {
  const [older, setOlder] = useState<OlderDeploymentLogs | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlderLogs = useAtomCommand(deploymentEnvironment.olderLogs, { reportFailure: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  // A log still being written opens at its end and is followed until the user scrolls up; a
  // finished one opens at its first line.
  const followRef = useRef(page.live);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pins the log scroller's scrollTop to the bottom after each commit while the user follows
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });

  const { lines, nextCursor } = deploymentLogsWithOlder(page, older);
  const timed = lines.some((line) => line.at !== undefined);

  const loadOlder = async () => {
    if (nextCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    const result = await loadOlderLogs({
      environmentId,
      input: { projectId, hostname, source, cursor: nextCursor },
    });
    setLoadingOlder(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Older logs could not be read" });
      return;
    }
    setOlder(prependOlderDeploymentLogs(page, older, result.value));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {page.truncated || page.live ? (
        <div className="shrink-0 px-4 pt-2 text-xs text-muted-foreground">
          {page.truncated ? <p>Showing the newest lines only.</p> : null}
          {page.live ? <p>Building. New lines appear as they arrive.</p> : null}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2"
      >
        {nextCursor !== null ? (
          <div className="pb-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Loading…" : "Load older"}
            </Button>
          </div>
        ) : null}
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{SOURCE_COPY[source].empty}</p>
        ) : (
          <div className="font-mono text-xs leading-5 select-text">
            {lines.map((line, index) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- lines have no identity besides position
                key={index}
                className={cn(
                  "flex min-h-5 gap-2",
                  line.level === undefined ? undefined : LEVEL_CLASS_NAME[line.level],
                )}
              >
                {timed ? (
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {line.at === undefined ? null : logLineClock(line.at)}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One source of a deployment's logs: its newest page, and the older ones the user asks for. */
export function DeploymentLogView({
  page,
  error,
  refreshing,
  onRetry,
  ...target
}: DeploymentLogTarget & {
  readonly page: DeploymentLogPage | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly onRetry: () => void;
}) {
  if (page === null) {
    if (error === null) return <DeploymentLogGhost />;
    return (
      <PullRequestsUnavailableState
        title={SOURCE_COPY[target.source].failed}
        error={error}
        onRetry={onRetry}
        refreshing={refreshing}
      />
    );
  }
  return <DeploymentLogLines {...target} page={page} />;
}
