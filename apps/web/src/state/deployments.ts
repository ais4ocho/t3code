import {
  createDeploymentEnvironmentAtoms,
  createMergedDeploymentListAtoms,
  type DeploymentListTarget,
  type MergedDeploymentLists,
} from "@t3tools/client-runtime/state/deployments";
import { useAtomValue } from "@effect/atom-react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { formatEnvironmentQueryError } from "./query";

export type { DeploymentListTarget };

export const deploymentEnvironment = createDeploymentEnvironmentAtoms(connectionAtomRuntime);

const mergedDeploymentLists = createMergedDeploymentListAtoms(
  deploymentEnvironment.list,
  formatEnvironmentQueryError,
);

/** Every listed project's deployments, read together; no targets reads nothing. */
export function useDeploymentLists(
  targets: ReadonlyArray<DeploymentListTarget>,
): MergedDeploymentLists & { readonly refresh: () => void } {
  const view = useAtomValue(mergedDeploymentLists.atom(targets));
  return { ...view, refresh: () => mergedDeploymentLists.refresh(appAtomRegistry, targets) };
}
