import {
  type DeploymentDiscoveryResult,
  type DeploymentError,
  type DeploymentListInput,
  type DeploymentListResult,
  type DeploymentLogPage,
  type DeploymentLogsInput,
  DeploymentOperationError,
  DeploymentUnavailableError,
  type ProjectId,
} from "@t3tools/contracts";
import type { DeploymentProviderError } from "@t3tools/deployment-core/server/DeploymentProvider";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as DeploymentProviderRegistry from "./DeploymentProviderRegistry.ts";

// Each read spawns the provider's CLI, so readers that arrive together share one. Clients decide
// how often to read; this only has to outlast a burst.
const LIST_CACHE_TTL = Duration.seconds(5);
const LIST_CACHE_CAPACITY = 64;
// Neither a project id nor a branch name can hold a line break.
const KEY_SEPARATOR = "\n";

function isProviderUnusable(error: DeploymentProviderError): boolean {
  return error.reason === "missing-tool" || error.reason === "unauthenticated";
}

function toDeploymentError(operation: string): (error: DeploymentProviderError) => DeploymentError {
  return (error) =>
    isProviderUnusable(error)
      ? new DeploymentUnavailableError({
          reason: error.reason === "missing-tool" ? "tool-missing" : "unauthenticated",
          provider: error.provider,
          cause: error,
        })
      : new DeploymentOperationError({
          operation,
          detail: error.detail.trim() || "The deployment provider failed.",
          cause: error,
        });
}

export class DeploymentService extends Context.Service<
  DeploymentService,
  {
    readonly discover: Effect.Effect<DeploymentDiscoveryResult>;
    /** A provider that cannot be read is a result, not a failure, so a list can say why. */
    readonly list: (
      input: DeploymentListInput,
    ) => Effect.Effect<DeploymentListResult, DeploymentError>;
    readonly logs: (
      input: DeploymentLogsInput,
    ) => Effect.Effect<DeploymentLogPage, DeploymentError>;
  }
>()("t3/deployment/DeploymentService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const { providers } = yield* DeploymentProviderRegistry.DeploymentProviderRegistry;

  const projectFor = Effect.fn("DeploymentService.projectFor")(function* (
    operation: string,
    projectId: ProjectId,
  ) {
    const shell = yield* projects.getShell(projectId).pipe(
      Effect.mapError(
        (cause) =>
          new DeploymentOperationError({
            operation,
            detail: "The project could not be read.",
            cause,
          }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new DeploymentOperationError({
                operation,
                detail: "This project no longer exists on the server.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    for (const provider of providers) {
      const project = yield* provider.projectFor(shell.workspaceRoot);
      if (project !== null) return { provider, project };
    }
    return null;
  });

  const listCache = yield* Cache.makeWith(
    Effect.fn("DeploymentService.readList")(function* (key: string) {
      const [projectId, branch] = key.split(KEY_SEPARATOR) as [ProjectId, string];
      const found = yield* projectFor("list", projectId);
      if (found === null) return { status: "unlinked" } satisfies DeploymentListResult;
      const { provider, project } = found;
      return yield* project.list({ branch: branch === "" ? undefined : branch }).pipe(
        Effect.map((deployments): DeploymentListResult => ({
          status: "linked",
          provider: provider.kind,
          projectName: project.name,
          deployments,
        })),
        Effect.catchIf(isProviderUnusable, (error) =>
          Effect.succeed<DeploymentListResult>({
            status: "unavailable",
            provider: provider.kind,
            projectName: project.name,
            reason: error.reason === "missing-tool" ? "tool-missing" : "unauthenticated",
            hint:
              error.reason === "missing-tool"
                ? provider.hints.toolMissing
                : provider.hints.unauthenticated,
          }),
        ),
        Effect.mapError(toDeploymentError("list")),
      );
    }),
    {
      capacity: LIST_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isFailure(exit) ? Duration.zero : LIST_CACHE_TTL),
    },
  );

  return DeploymentService.of({
    discover: Effect.forEach(providers, (provider) => provider.discover, {
      concurrency: "unbounded",
    }).pipe(Effect.map((discovered) => ({ providers: discovered }))),
    list: Effect.fn("DeploymentService.list")((input) =>
      Cache.get(listCache, `${input.projectId}${KEY_SEPARATOR}${input.branch ?? ""}`),
    ),
    logs: Effect.fn("DeploymentService.logs")(function* (input) {
      const found = yield* projectFor("logs", input.projectId);
      if (found === null) return yield* new DeploymentUnavailableError({ reason: "unlinked" });
      return yield* found.project.logs(input).pipe(Effect.mapError(toDeploymentError("logs")));
    }),
  });
});

export const layer = Layer.effect(DeploymentService, make);
