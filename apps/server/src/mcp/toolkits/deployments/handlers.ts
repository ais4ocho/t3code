import type { DeploymentListResult, DeploymentLogLine, ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DeploymentService from "../../../deployment/DeploymentService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  DeploymentProjectRequiredError,
  DeploymentsToolkit,
  type ListDeploymentsResult,
} from "./tools.ts";

const MAX_DEPLOYMENTS = 20;
const MAX_BUILD_LINES = 300;
const MAX_LINE_CHARACTERS = 500;

const UNLINKED_DETAIL =
  "The project folder has no .vercel/project.json; running `vercel link` there creates one.";

function listResult(result: DeploymentListResult): ListDeploymentsResult {
  switch (result.status) {
    case "unlinked":
      return { status: "unlinked", deployments: [], detail: UNLINKED_DETAIL };
    case "unavailable":
      return {
        status: "unavailable",
        projectName: result.projectName,
        deployments: [],
        reason: result.reason,
        hint: result.hint,
      };
    case "linked":
      return {
        status: "linked",
        projectName: result.projectName,
        deployments: result.deployments.slice(0, MAX_DEPLOYMENTS).map((deployment) => ({
          hostname: deployment.hostname,
          url: `https://${deployment.hostname}`,
          state: deployment.state,
          target: deployment.target,
          createdAt: deployment.createdAt,
          ...(deployment.readyAt === undefined ? {} : { readyAt: deployment.readyAt }),
          ...(deployment.branch === undefined ? {} : { branch: deployment.branch }),
          ...(deployment.commitSha === undefined ? {} : { commitSha: deployment.commitSha }),
          ...(deployment.commitTitle === undefined ? {} : { commitTitle: deployment.commitTitle }),
        })),
      };
  }
}

function formatLine(line: DeploymentLogLine): string {
  const at = line.at === undefined ? Option.none() : DateTime.make(line.at);
  const time = Option.isSome(at) ? DateTime.formatIso(at.value).slice(11, 19) : undefined;
  const text =
    line.text.length > MAX_LINE_CHARACTERS ? line.text.slice(0, MAX_LINE_CHARACTERS) : line.text;
  return [time, line.level, text].filter((part) => part !== undefined).join(" ");
}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const deployments = yield* DeploymentService.DeploymentService;

  const requireProject = Effect.fn("DeploymentsToolkit.requireProject")(function* (
    requested: ProjectId | undefined,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("deployments");
    if (requested !== undefined) return requested;
    const thread =
      scope.thread === undefined
        ? null
        : yield* engine
            .getThreadShell(scope.thread.threadId)
            .pipe(Effect.orElseSucceed(() => null));
    if (thread === null) return yield* new DeploymentProjectRequiredError();
    return thread.projectId;
  });

  return {
    list_deployments: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const projectId = yield* requireProject(input.projectId);
        const result = yield* deployments.list({
          projectId,
          ...(input.branch === undefined ? {} : { branch: input.branch }),
        });
        return listResult(result);
      }),
    ),
    read_deployment_logs: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const projectId = yield* requireProject(input.projectId);
        const page = yield* deployments.logs({
          projectId,
          hostname: input.hostname,
          source: input.source,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        });
        const lines = input.source === "build" ? page.lines.slice(-MAX_BUILD_LINES) : page.lines;
        const cut = lines.some((line) => line.text.length > MAX_LINE_CHARACTERS);
        return {
          log: lines.map(formatLine).join("\n"),
          truncated: page.truncated || lines.length < page.lines.length || cut,
          live: page.live,
          nextCursor: page.nextCursor,
        };
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof DeploymentsToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(DeploymentsToolkit, make);
