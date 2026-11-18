import {
  deploymentBuildDuration,
  deploymentTargetLabel,
  deploymentTitle,
  deploymentUrl,
} from "@t3tools/client-runtime/deployment-presentation";
import {
  DEPLOYMENT_IN_PROGRESS_REFRESH_MS,
  deploymentListRefreshMs,
} from "@t3tools/client-runtime/state/deployments";
import type {
  Deployment,
  DeploymentListResult,
  DeploymentLogSource,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { RelativeTime } from "~/components/RelativeTime";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { cn } from "~/lib/utils";
import {
  deploymentEnvironment,
  deploymentListRefreshKey,
  type DeploymentListTarget,
} from "~/state/deployments";
import { useEnvironmentQuery } from "~/state/query";

import {
  PullRequestDetailTabBar,
  PullRequestDetailTitleRow,
} from "../pullRequest/PullRequestDetailLayout";
import { PullRequestMetaLine } from "../pullRequest/pullRequestPresentation";
import { Button, InlineButton } from "../ui/button";
import { DeploymentDetailGhost } from "./DeploymentDetailGhost";
import { DeploymentLogView } from "./DeploymentLogView";
import { deploymentStateMark } from "./deploymentPresentation";

const LOG_TABS = [
  { value: "build", label: "Build logs" },
  { value: "runtime", label: "Runtime logs" },
] as const satisfies ReadonlyArray<{ value: DeploymentLogSource; label: string }>;

interface DeploymentPanelTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly hostname: string;
  /** The branch filter of the list the deployment was opened from; absent for an unfiltered one. */
  readonly branch?: string | undefined;
}

// The input's JSON is the query's cache key, so every reader of a list builds it this way.
function deploymentListTarget({
  environmentId,
  projectId,
  branch,
}: DeploymentPanelTarget): DeploymentListTarget {
  return { environmentId, input: { projectId, ...(branch === undefined ? {} : { branch }) } };
}

function listedDeployment(list: DeploymentListResult | null, hostname: string): Deployment | null {
  if (list?.status !== "linked") return null;
  return list.deployments.find((deployment) => deployment.hostname === hostname) ?? null;
}

/** A deployment tab's name once the list its panel reads knows the deployment; null until then. */
export function useDeploymentTabTitle(target: DeploymentPanelTarget | null): string | null {
  const list = useEnvironmentQuery(
    target === null ? null : deploymentEnvironment.list(deploymentListTarget(target)),
  ).data;
  const deployment = target === null ? null : listedDeployment(list, target.hostname);
  return deployment === null ? null : deploymentTitle(deployment);
}

export function DeploymentDetailPanel(target: DeploymentPanelTarget) {
  const { environmentId, projectId, hostname } = target;
  const listTarget = deploymentListTarget(target);
  const listQuery = useEnvironmentQuery(deploymentEnvironment.list(listTarget));
  const [source, setSource] = useState<DeploymentLogSource>("build");
  const logsQuery = useEnvironmentQuery(
    deploymentEnvironment.logs({ environmentId, input: { projectId, hostname, source } }),
  );
  const listRefreshMs = deploymentListRefreshMs(listQuery.data);
  useLiveRefresh(
    () => {
      if (!listQuery.isPending) listQuery.refresh();
    },
    {
      key: deploymentListRefreshKey(listTarget),
      enabled: listRefreshMs !== null,
      intervalMs: listRefreshMs,
    },
  );
  // A build log grows until the build ends. Runtime logs never end, so they are read again only
  // when the user comes back to the window.
  const logsLive = logsQuery.data?.live === true;
  useLiveRefresh(
    () => {
      if (!logsQuery.isPending) logsQuery.refresh();
    },
    {
      key: `deployment-logs:${environmentId}:${hostname}:${source}`,
      enabled: logsLive || (source === "runtime" && logsQuery.data !== null),
      intervalMs: logsLive ? DEPLOYMENT_IN_PROGRESS_REFRESH_MS : null,
    },
  );

  if (listQuery.data === null && listQuery.error === null) return <DeploymentDetailGhost />;

  // A list only holds recent deployments; an older one still has its hostname and its logs.
  const deployment = listedDeployment(listQuery.data, hostname);
  const mark = deployment === null ? null : deploymentStateMark(deployment.state);
  const duration = deployment === null ? null : deploymentBuildDuration(deployment);
  const refreshing = listQuery.isPending || logsQuery.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60">
        <div className="px-4 pb-3">
          <PullRequestDetailTitleRow className="h-7 gap-1 text-sm sm:text-xs">
            {deployment ? (
              <span className="shrink-0 font-medium text-muted-foreground">
                {deploymentTargetLabel(deployment.target)}
              </span>
            ) : null}
            <InlineButton
              className="shrink-0 font-medium"
              render={
                <a href={deploymentUrl(hostname)} target="_blank" rel="noopener noreferrer" />
              }
            >
              Visit
              <ExternalLinkIcon aria-hidden className="size-2.5" />
            </InlineButton>
            <span className="flex-1" />
            {mark ? (
              <span className="flex shrink-0 items-center gap-1 font-medium">
                <mark.Icon aria-hidden className={cn("size-3.5 shrink-0", mark.toneClassName)} />
                {mark.label}
              </span>
            ) : null}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh deployment"
              disabled={refreshing}
              onClick={() => {
                listQuery.refresh();
                logsQuery.refresh();
              }}
            >
              <RefreshIcon size="sm" refreshing={refreshing} />
            </Button>
          </PullRequestDetailTitleRow>

          <PullRequestDetailTitleRow className="mt-1">
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug break-words">
              {deployment ? deploymentTitle(deployment) : hostname}
            </h2>
          </PullRequestDetailTitleRow>

          {deployment ? (
            <>
              <PullRequestMetaLine className="mt-2 min-h-5 text-xs text-muted-foreground">
                {deployment.creator ? (
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {deployment.creator}
                  </span>
                ) : null}
                <span className="shrink-0">
                  created <RelativeTime timestamp={deployment.createdAt} />
                </span>
                {duration ? <span className="shrink-0">built in {duration}</span> : null}
              </PullRequestMetaLine>
              {deployment.branch || deployment.commitSha ? (
                <PullRequestMetaLine className="mt-1 min-h-5 font-mono text-xs text-muted-foreground/70">
                  {deployment.branch ? (
                    <span className="min-w-0 truncate">{deployment.branch}</span>
                  ) : null}
                  {deployment.commitSha ? (
                    <span className="shrink-0">{deployment.commitSha.slice(0, 7)}</span>
                  ) : null}
                </PullRequestMetaLine>
              ) : null}
            </>
          ) : null}
        </div>
        <PullRequestDetailTabBar
          label="Deployment logs"
          tabs={LOG_TABS}
          value={source}
          onValueChange={setSource}
        />
      </div>
      <DeploymentLogView
        key={source}
        environmentId={environmentId}
        projectId={projectId}
        hostname={hostname}
        source={source}
        page={logsQuery.data}
        error={logsQuery.error}
        refreshing={logsQuery.isPending}
        onRetry={logsQuery.refresh}
      />
    </div>
  );
}
