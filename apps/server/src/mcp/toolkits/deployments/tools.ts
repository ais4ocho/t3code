import {
  DeploymentHostname,
  DeploymentLogSource,
  DeploymentLogsInput,
  DeploymentOperationError,
  DeploymentState,
  DeploymentTarget,
  DeploymentUnavailableError,
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as DeploymentService from "../../../deployment/DeploymentService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  Orchestrator.OrchestratorV2,
  DeploymentService.DeploymentService,
];

export class DeploymentProjectRequiredError extends Schema.TaggedError<DeploymentProjectRequiredError>()(
  "DeploymentProjectRequiredError",
  {},
) {
  override get message(): string {
    return "Pass projectId: this MCP client is not running inside a T3 thread.";
  }
}

export const DeploymentToolError = Schema.Union([
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  DeploymentUnavailableError,
  DeploymentOperationError,
  DeploymentProjectRequiredError,
]);
export type DeploymentToolError = typeof DeploymentToolError.Type;

const projectIdParameter = Schema.optional(
  ProjectId.annotate({ description: "Defaults to this thread's project." }),
);

export const DeploymentEntry = Schema.Struct({
  hostname: Schema.String,
  url: Schema.String,
  state: DeploymentState,
  target: DeploymentTarget,
  createdAt: Schema.String,
  readyAt: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  commitSha: Schema.optional(Schema.String),
  commitTitle: Schema.optional(Schema.String),
});
export type DeploymentEntry = typeof DeploymentEntry.Type;

export const ListDeploymentsResult = Schema.Struct({
  status: Schema.Literals(["linked", "unlinked", "unavailable"]),
  projectName: Schema.optional(Schema.String),
  /** Newest first. */
  deployments: Schema.Array(DeploymentEntry),
  reason: Schema.optional(Schema.Literals(["tool-missing", "unauthenticated"])),
  /** What the user can run on the server to make deployments readable. */
  hint: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});
export type ListDeploymentsResult = typeof ListDeploymentsResult.Type;

export const ReadDeploymentLogsResult = Schema.Struct({
  /** One `HH:MM:SS level text` line per log line, oldest first. */
  log: Schema.String,
  truncated: Schema.Boolean.annotate({
    description: "True when lines were left out or cut short.",
  }),
  live: Schema.Boolean,
  nextCursor: Schema.NullOr(Schema.String),
});
export type ReadDeploymentLogsResult = typeof ReadDeploymentLogsResult.Type;

const ListDeploymentsTool = Tool.make("list_deployments", {
  description:
    "List a project's recent deployments, newest first. When they cannot be read, the result says why and what the user can run to fix it.",
  parameters: Schema.Struct({
    projectId: projectIdParameter,
    branch: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(255)).annotate({
        description: "Only deployments built from this branch.",
      }),
    ),
  }),
  success: ListDeploymentsResult,
  failure: DeploymentToolError,
  dependencies,
})
  .annotate(Tool.Title, "List deployments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ReadDeploymentLogsTool = Tool.make("read_deployment_logs", {
  description:
    "Read a deployment's build or runtime logs; a failed deployment's build log ends with the error. live: true means it is still building, so read again later for more.",
  parameters: Schema.Struct({
    projectId: projectIdParameter,
    hostname: DeploymentHostname.annotate({ description: "From list_deployments." }),
    source: DeploymentLogSource,
    cursor: DeploymentLogsInput.fields.cursor.annotate({
      description: "A nextCursor from an earlier call, to read older lines.",
    }),
  }),
  success: ReadDeploymentLogsResult,
  failure: DeploymentToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read deployment logs")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const DeploymentsToolkit = Toolkit.make(ListDeploymentsTool, ReadDeploymentLogsTool);
