import { deploymentTitle } from "@t3tools/client-runtime/deployment-presentation";
import { deploymentListRefreshMs } from "@t3tools/client-runtime/state/deployments";
import { selectEnvironmentQueryData } from "@t3tools/client-runtime/state/runtime";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";

import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { deploymentEnvironment, deploymentListRefreshKey } from "~/state/deployments";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentQueryRefresh, useEnvironmentQuerySelector } from "~/state/query";

import { deploymentStateMark } from "../deployment/deploymentPresentation";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";

/**
 * The thread details panel's deployment row, after the issue rows: the newest deployment of the
 * thread's branch. It opens in the right panel, which reads the same list.
 */
export function ThreadDetailsDeploymentRow({
  threadRef,
  projectId,
  branch,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId | null;
  branch: string | null;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { environmentId } = threadRef;
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.deployments === true;
  const target =
    supported && projectId !== null && branch !== null
      ? { environmentId, input: { projectId, branch } }
      : null;
  const atom = target === null ? null : deploymentEnvironment.list(target);
  const list = useEnvironmentQuerySelector(atom, selectEnvironmentQueryData);
  const query = useEnvironmentQueryRefresh(atom);
  const refreshMs = deploymentListRefreshMs(list);
  useLiveRefresh(
    () => {
      if (!query.isPending()) query.refresh();
    },
    {
      // The panel this row opens reads the same list under the same name.
      ...(target === null ? {} : { key: deploymentListRefreshKey(target) }),
      enabled: target !== null && refreshMs !== null,
      intervalMs: refreshMs,
    },
  );
  const deployment = list?.status === "linked" ? list.deployments[0] : undefined;
  if (deployment === undefined || projectId === null || branch === null) return null;

  const mark = deploymentStateMark(deployment.state, messages);
  const label =
    deployment.target === "production" ? gt("Production deployment") : gt("Preview deployment");
  return (
    <ThreadDetailsControl
      part="row"
      aria-label={gt("{deployment}, {state}: {title}", {
        $context: "screen reader label: deployment kind, its status, then its commit title",
        deployment: label,
        state: mark.label.toLowerCase(),
        title: deploymentTitle(deployment),
      })}
      onClick={(event) => {
        event.stopPropagation();
        useRightPanelStore.getState().openDeployment(threadRef, {
          environmentId,
          projectId,
          hostname: deployment.hostname,
          branch,
        });
      }}
    >
      <mark.Icon aria-hidden className={cn("size-4 shrink-0", mark.toneClassName)} />
      <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
        {label} · {mark.label}
      </span>
    </ThreadDetailsControl>
  );
}
