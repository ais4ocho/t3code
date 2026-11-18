import {
  deploymentTargetLabel,
  deploymentTitle,
} from "@t3tools/client-runtime/deployment-presentation";
import type { ListedDeployment } from "@t3tools/client-runtime/state/deployments";
import { memo } from "react";

import { cn } from "~/lib/utils";

import { PULL_REQUEST_ROW_CLASS, PullRequestRowLines } from "../pullRequest/PullRequestListRow";
import { DeploymentStateGlyph } from "./deploymentPresentation";

/** The page row in the pull-request list's shape: state glyph, then title over meta. */
function DeploymentRowImpl({
  entry,
  selected,
  onSelect,
}: {
  entry: ListedDeployment;
  selected: boolean;
  onSelect: (entry: ListedDeployment) => void;
}) {
  const { deployment } = entry;
  return (
    <div
      className={cn(
        "flex items-center rounded-md [content-visibility:auto] [contain-intrinsic-block-size:56.5px]",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry)}
        className={cn(PULL_REQUEST_ROW_CLASS, "px-3 py-2.5")}
      >
        <DeploymentStateGlyph state={deployment.state} />
        <PullRequestRowLines
          number={null}
          title={deploymentTitle(deployment)}
          meta={
            <>
              <span className="truncate">{entry.projectName}</span>
              <span className="shrink-0">{deploymentTargetLabel(deployment.target)}</span>
              {deployment.branch ? (
                <span className="truncate font-mono">{deployment.branch}</span>
              ) : null}
              {deployment.commitSha ? (
                <span className="shrink-0 font-mono">{deployment.commitSha.slice(0, 7)}</span>
              ) : null}
              {deployment.creator ? <span className="truncate">{deployment.creator}</span> : null}
            </>
          }
          updatedAt={deployment.createdAt}
        />
      </button>
    </div>
  );
}

export const DeploymentRow = memo(DeploymentRowImpl);
