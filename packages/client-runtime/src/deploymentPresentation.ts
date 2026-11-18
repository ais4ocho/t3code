import type { Deployment, DeploymentState, DeploymentTarget } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";

export type DeploymentTone = "pending" | "success" | "failure" | "neutral";

export interface DeploymentStatePresentation {
  readonly label: string;
  readonly tone: DeploymentTone;
}

const DEPLOYMENT_STATE_PRESENTATION: Record<DeploymentState, DeploymentStatePresentation> = {
  queued: { label: "Queued", tone: "pending" },
  building: { label: "Building", tone: "pending" },
  ready: { label: "Ready", tone: "success" },
  error: { label: "Failed", tone: "failure" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export function deploymentStatePresentation(state: DeploymentState): DeploymentStatePresentation {
  return DEPLOYMENT_STATE_PRESENTATION[state];
}

export function deploymentTargetLabel(target: DeploymentTarget): string {
  return target === "production" ? "Production" : "Preview";
}

/** What a row calls a deployment: its commit when it has one, else where it is served. */
export function deploymentTitle(deployment: Pick<Deployment, "commitTitle" | "hostname">): string {
  return deployment.commitTitle ?? deployment.hostname;
}

export function deploymentUrl(hostname: Deployment["hostname"]): string {
  return `https://${hostname}`;
}

/** How long the deployment took to become ready; null while it has not, or if it never did. */
export function deploymentBuildDuration(
  deployment: Pick<Deployment, "createdAt" | "readyAt">,
): string | null {
  if (deployment.readyAt === undefined) return null;
  const elapsed = Date.parse(deployment.readyAt) - Date.parse(deployment.createdAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? formatDuration(elapsed) : null;
}
