import {
  deploymentTargetLabel,
  deploymentTitle,
} from "@t3tools/client-runtime/deployment-presentation";
import { selectEnvironmentQueryData } from "@t3tools/client-runtime/state/runtime";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { deploymentEnvironment } from "~/state/deployments";
import { useServerConfigs } from "~/state/entities";
import { useEnvironmentQuerySelector } from "~/state/query";

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
  const { environmentId } = threadRef;
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.deployments === true;
  const list = useEnvironmentQuerySelector(
    supported && projectId !== null && branch !== null
      ? deploymentEnvironment.list({ environmentId, input: { projectId, branch } })
      : null,
    selectEnvironmentQueryData,
  );
  const deployment = list?.status === "linked" ? list.deployments[0] : undefined;
  if (deployment === undefined || projectId === null || branch === null) return null;

  const mark = deploymentStateMark(deployment.state);
  const label = `${deploymentTargetLabel(deployment.target)} deployment`;
  return (
    <ThreadDetailsControl
      part="row"
      aria-label={`${label}, ${mark.label.toLowerCase()}: ${deploymentTitle(deployment)}`}
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
