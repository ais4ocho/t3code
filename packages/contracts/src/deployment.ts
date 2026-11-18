import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DeploymentProviderKind = Schema.Literals(["vercel"]);
export type DeploymentProviderKind = typeof DeploymentProviderKind.Type;

export const DeploymentState = Schema.Literals([
  "queued",
  "building",
  "ready",
  "error",
  "canceled",
]);
export type DeploymentState = typeof DeploymentState.Type;

export const DeploymentTarget = Schema.Literals(["production", "preview"]);
export type DeploymentTarget = typeof DeploymentTarget.Type;

/** A deployment's hostname. It reaches a CLI as an argument, so it can never start with `-`. */
export const DeploymentHostname = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9.-]{0,252}$/u),
);
export type DeploymentHostname = typeof DeploymentHostname.Type;

export const Deployment = Schema.Struct({
  provider: DeploymentProviderKind,
  /** The provider lists deployments by hostname, so this is also the deployment's identity. */
  hostname: DeploymentHostname,
  state: DeploymentState,
  target: DeploymentTarget,
  createdAt: IsoDateTime,
  readyAt: Schema.optionalKey(IsoDateTime),
  branch: Schema.optionalKey(TrimmedNonEmptyString),
  commitSha: Schema.optionalKey(TrimmedNonEmptyString),
  /** The commit's first line. */
  commitTitle: Schema.optionalKey(TrimmedNonEmptyString),
  creator: Schema.optionalKey(TrimmedNonEmptyString),
});
export type Deployment = typeof Deployment.Type;

export const DeploymentAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type DeploymentAuthStatus = typeof DeploymentAuthStatus.Type;

export const DeploymentProviderDiscoveryItem = Schema.Struct({
  kind: DeploymentProviderKind,
  label: TrimmedNonEmptyString,
  executable: TrimmedNonEmptyString,
  status: Schema.Literals(["available", "missing"]),
  version: Schema.optionalKey(TrimmedNonEmptyString),
  installHint: TrimmedNonEmptyString,
  auth: DeploymentAuthStatus,
  account: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DeploymentProviderDiscoveryItem = typeof DeploymentProviderDiscoveryItem.Type;

export const DeploymentDiscoveryResult = Schema.Struct({
  providers: Schema.Array(DeploymentProviderDiscoveryItem),
});
export type DeploymentDiscoveryResult = typeof DeploymentDiscoveryResult.Type;

export const DeploymentListInput = Schema.Struct({
  projectId: ProjectId,
  /** Only deployments built from this branch. */
  branch: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  /** Skips the server's cache, for a refresh the user asked for. */
  fresh: Schema.optional(Schema.Boolean),
});
export type DeploymentListInput = typeof DeploymentListInput.Type;

export const DeploymentListResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("linked"),
    provider: DeploymentProviderKind,
    projectName: TrimmedNonEmptyString,
    deployments: Schema.Array(Deployment),
  }),
  /** No deployment provider claims the project's checkout. */
  Schema.Struct({ status: Schema.Literal("unlinked") }),
  /** A provider claims the checkout, but its CLI is missing or signed out on the server. */
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    provider: DeploymentProviderKind,
    projectName: TrimmedNonEmptyString,
    reason: Schema.Literals(["missing-cli", "unauthenticated"]),
    hint: TrimmedNonEmptyString,
  }),
]);
export type DeploymentListResult = typeof DeploymentListResult.Type;

export const DeploymentLogSource = Schema.Literals(["build", "runtime"]);
export type DeploymentLogSource = typeof DeploymentLogSource.Type;

export const DeploymentLogsInput = Schema.Struct({
  projectId: ProjectId,
  hostname: DeploymentHostname,
  source: DeploymentLogSource,
  /** A `next` from an earlier page of the same logs. It reaches a CLI as an argument. */
  cursor: Schema.optional(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_=-]{1,4096}$/u))),
});
export type DeploymentLogsInput = typeof DeploymentLogsInput.Type;

export const DeploymentLogLine = Schema.Struct({
  at: Schema.optionalKey(IsoDateTime),
  level: Schema.optionalKey(Schema.Literals(["info", "warning", "error"])),
  text: Schema.String,
});
export type DeploymentLogLine = typeof DeploymentLogLine.Type;

export const DeploymentLogPage = Schema.Struct({
  /** Oldest first. */
  lines: Schema.Array(DeploymentLogLine),
  /** The provider had more than the server was willing to carry, so some lines are missing. */
  truncated: Schema.Boolean,
  /** Reads the next older page. */
  next: Schema.optionalKey(Schema.String),
});
export type DeploymentLogPage = typeof DeploymentLogPage.Type;

export const DeploymentErrorReason = Schema.Literals([
  "project-not-found",
  "unlinked",
  "missing-cli",
  "unauthenticated",
  "timeout",
  "unreadable-output",
  "failed",
]);
export type DeploymentErrorReason = typeof DeploymentErrorReason.Type;

export class DeploymentError extends Schema.TaggedError<DeploymentError>()("DeploymentError", {
  reason: DeploymentErrorReason,
  provider: Schema.optional(DeploymentProviderKind),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "project-not-found":
        return "This project no longer exists on the server.";
      case "unlinked":
        return "This project is not linked to a deployment provider.";
      case "missing-cli":
        return "The deployment provider's CLI is not installed on the server.";
      case "unauthenticated":
        return "The deployment provider's CLI is signed out on the server.";
      case "timeout":
        return "The deployment provider did not answer in time.";
      case "unreadable-output":
        return "The deployment provider's CLI returned output T3 Code could not read.";
      case "failed":
        return "The deployment provider's CLI failed.";
    }
  }
}
