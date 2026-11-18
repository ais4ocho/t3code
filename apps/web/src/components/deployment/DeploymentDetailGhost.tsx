import { GhostBar } from "../pullRequest/PullRequestGhosts";

const LINE_WIDTHS = ["w-2/3", "w-1/2", "w-3/4", "w-2/5", "w-3/5", "w-1/3"];

function GhostLogLines() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }, (_, index) => (
        <GhostBar key={index} className={LINE_WIDTHS[index % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}

/** The log area while its first page loads. */
export function DeploymentLogGhost() {
  return (
    <div
      role="status"
      aria-label="Loading logs"
      className="motion-safe:animate-skeleton min-h-0 flex-1 overflow-hidden px-4 py-3"
    >
      <GhostLogLines />
    </div>
  );
}

/** The deployment panel until the list that describes the deployment has answered. */
export function DeploymentDetailGhost() {
  return (
    <div
      role="status"
      aria-label="Loading deployment"
      className="motion-safe:animate-skeleton flex h-full min-h-0 flex-col gap-4 overflow-hidden px-4 pt-3 pb-4"
    >
      <div className="flex h-7 items-center gap-2">
        <GhostBar className="w-16" />
        <GhostBar className="w-10" />
      </div>
      <GhostBar className="h-5 w-3/4" />
      <GhostBar className="w-48" />
      <GhostBar className="w-32" />
      <div className="flex gap-2">
        <GhostBar className="h-6 w-20 rounded-md" />
        <GhostBar className="h-6 w-24 rounded-md" />
      </div>
      <GhostLogLines />
    </div>
  );
}
