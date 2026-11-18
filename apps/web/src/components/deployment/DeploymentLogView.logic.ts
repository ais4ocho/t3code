import type { DeploymentLogLine, DeploymentLogPage } from "@t3tools/contracts";

/** The pages read behind one first page. Read again, that page is a new object and starts over. */
export interface OlderDeploymentLogs {
  readonly first: DeploymentLogPage;
  /** Oldest first. */
  readonly lines: ReadonlyArray<DeploymentLogLine>;
  readonly nextCursor: DeploymentLogPage["nextCursor"];
}

export function prependOlderDeploymentLogs(
  first: DeploymentLogPage,
  held: OlderDeploymentLogs | null,
  older: DeploymentLogPage,
): OlderDeploymentLogs {
  const lines = held?.first === first ? held.lines : [];
  return { first, lines: [...older.lines, ...lines], nextCursor: older.nextCursor };
}

/** The lines to show, and the cursor behind the oldest of them. */
export function deploymentLogsWithOlder(
  first: DeploymentLogPage,
  held: OlderDeploymentLogs | null,
): Pick<DeploymentLogPage, "lines" | "nextCursor"> {
  if (held?.first !== first) return first;
  return { lines: [...held.lines, ...first.lines], nextCursor: held.nextCursor };
}
