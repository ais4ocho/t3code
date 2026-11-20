import type { Deployment, DeploymentState, DeploymentTarget } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export type DeploymentTone = "pending" | "success" | "failure" | "neutral";

export interface DeploymentStatePresentation {
  readonly label: string;
  readonly tone: DeploymentTone;
}

const DEPLOYMENT_STATE_PRESENTATION: Record<DeploymentState, DeploymentStatePresentation> = {
  queued: { label: msg("Queued", { $context: "deployment status" }), tone: "pending" },
  building: { label: msg("Building", { $context: "deployment status" }), tone: "pending" },
  ready: { label: msg("Ready", { $context: "deployment status" }), tone: "success" },
  error: { label: msg("Failed", { $context: "deployment status" }), tone: "failure" },
  canceled: { label: msg("Canceled", { $context: "deployment status" }), tone: "neutral" },
};

export function deploymentStatePresentation(
  state: DeploymentState,
  resolve: MFunctionType = mFallback,
): DeploymentStatePresentation {
  const { label, tone } = DEPLOYMENT_STATE_PRESENTATION[state];
  return { label: resolve(label), tone };
}

export function deploymentTargetLabel(
  target: DeploymentTarget,
  resolve: MFunctionType = mFallback,
): string {
  return target === "production"
    ? resolve(msg("Production", { $context: "deployment environment" }))
    : resolve(msg("Preview", { $context: "deployment environment" }));
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
