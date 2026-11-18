import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Open, so a client keeps reading a server that knows a provider it does not. */
export const DeploymentProviderKind = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
).pipe(Schema.brand("DeploymentProviderKind"));
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
  readyAt: Schema.optional(IsoDateTime),
  branch: Schema.optional(TrimmedNonEmptyString),
  commitSha: Schema.optional(TrimmedNonEmptyString),
  /** The commit's first line. */
  commitTitle: Schema.optional(TrimmedNonEmptyString),
  creator: Schema.optional(TrimmedNonEmptyString),
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
  version: Schema.optional(TrimmedNonEmptyString),
  installHint: TrimmedNonEmptyString,
  auth: DeploymentAuthStatus,
  account: Schema.optional(TrimmedNonEmptyString),
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
});
export type DeploymentListInput = typeof DeploymentListInput.Type;

export const DeploymentUnavailableReason = Schema.Literals([
  "tool-missing",
  "unauthenticated",
  "unlinked",
]);
export type DeploymentUnavailableReason = typeof DeploymentUnavailableReason.Type;

export const DeploymentListResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("linked"),
    provider: DeploymentProviderKind,
    projectName: TrimmedNonEmptyString,
    /** Newest first. */
    deployments: Schema.Array(Deployment),
  }),
  /** No deployment provider claims the project's checkout. */
  Schema.Struct({ status: Schema.Literal("unlinked") }),
  /** A provider claims the checkout, but its CLI is missing or signed out on the server. */
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    provider: DeploymentProviderKind,
    projectName: TrimmedNonEmptyString,
    reason: Schema.Literals(["tool-missing", "unauthenticated"]),
    hint: TrimmedNonEmptyString,
  }),
]);
export type DeploymentListResult = typeof DeploymentListResult.Type;

export const DeploymentLogSource = Schema.Literals(["build", "runtime"]);
export type DeploymentLogSource = typeof DeploymentLogSource.Type;

const DeploymentLogCursor = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_=-]{1,4096}$/u));

export const DeploymentLogsInput = Schema.Struct({
  projectId: ProjectId,
  hostname: DeploymentHostname,
  source: DeploymentLogSource,
  /** A `nextCursor` from an earlier page of the same logs. It reaches a CLI as an argument. */
  cursor: Schema.optional(DeploymentLogCursor),
});
export type DeploymentLogsInput = typeof DeploymentLogsInput.Type;

export const DeploymentLogLine = Schema.Struct({
  at: Schema.optional(IsoDateTime),
  /** Absent for an ordinary line. */
  level: Schema.optional(Schema.Literals(["warning", "error"])),
  text: Schema.String,
});
export type DeploymentLogLine = typeof DeploymentLogLine.Type;

export const DeploymentLogPage = Schema.Struct({
  /** Oldest first. */
  lines: Schema.Array(DeploymentLogLine),
  /** The provider had more than the server was willing to carry, so some lines are missing. */
  truncated: Schema.Boolean,
  /** Reads the next older page. Null when there is none. */
  nextCursor: Schema.NullOr(DeploymentLogCursor),
  /** The deployment is still building, so reading again later returns more. */
  live: Schema.Boolean,
});
export type DeploymentLogPage = typeof DeploymentLogPage.Type;

/** The provider cannot be read at all for this project, as opposed to one request failing. */
export class DeploymentUnavailableError extends Schema.TaggedError<DeploymentUnavailableError>()(
  "DeploymentUnavailableError",
  {
    reason: DeploymentUnavailableReason,
    provider: Schema.optional(DeploymentProviderKind),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "tool-missing":
        return "The deployment provider's CLI is not installed on the server.";
      case "unauthenticated":
        return "The deployment provider's CLI is signed out on the server.";
      case "unlinked":
        return "This project is not linked to a deployment provider.";
    }
  }
}

export class DeploymentOperationError extends Schema.TaggedError<DeploymentOperationError>()(
  "DeploymentOperationError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Deployment operation ${this.operation} failed: ${this.detail}`;
  }
}

export type DeploymentError = DeploymentUnavailableError | DeploymentOperationError;
