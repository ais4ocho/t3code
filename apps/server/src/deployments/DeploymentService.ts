import {
  DeploymentError,
  type DeploymentDiscoveryResult,
  type DeploymentListInput,
  type DeploymentListResult,
  type DeploymentLogPage,
  type DeploymentLogsInput,
  type ProjectId,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import { BUILT_IN_DEPLOYMENT_DRIVER_LIST } from "./deploymentDrivers.ts";

// Each read spawns the provider's CLI, so every client watching one project shares a result.
const LIST_CACHE_TTL = Duration.seconds(30);
// A deployment in progress changes state within seconds.
const ACTIVE_LIST_CACHE_TTL = Duration.seconds(8);
const LIST_CACHE_CAPACITY = 64;
// Neither a project id nor a branch name can hold a line break.
const KEY_SEPARATOR = "\n";

const hasActiveDeployment = (result: DeploymentListResult) =>
  result.status === "linked" &&
  result.deployments.some(({ state }) => state === "queued" || state === "building");

export class DeploymentService extends Context.Service<
  DeploymentService,
  {
    readonly discover: Effect.Effect<DeploymentDiscoveryResult>;
    readonly list: (
      input: DeploymentListInput,
    ) => Effect.Effect<DeploymentListResult, DeploymentError>;
    readonly logs: (
      input: DeploymentLogsInput,
    ) => Effect.Effect<DeploymentLogPage, DeploymentError>;
  }
>()("t3/deployments/DeploymentService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const drivers = yield* Effect.forEach(BUILT_IN_DEPLOYMENT_DRIVER_LIST, (driver) =>
    driver.make.pipe(Effect.map((instance) => ({ driver, instance }))),
  );

  const projectFor = Effect.fn("DeploymentService.projectFor")(function* (projectId: ProjectId) {
    const shell = yield* projects.getShell(projectId).pipe(
      Effect.mapError((cause) => new DeploymentError({ reason: "failed", cause })),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new DeploymentError({ reason: "project-not-found" })),
          onSome: Effect.succeed,
        }),
      ),
    );
    for (const { driver, instance } of drivers) {
      const project = yield* instance.projectFor(shell.workspaceRoot);
      if (project !== null) return { driver, project };
    }
    return null;
  });

  const listCache = yield* Cache.makeWith(
    Effect.fn("DeploymentService.readList")(function* (key: string) {
      const [projectId, branch] = key.split(KEY_SEPARATOR) as [ProjectId, string];
      const found = yield* projectFor(projectId);
      if (found === null) return { status: "unlinked" } satisfies DeploymentListResult;
      const { driver, project } = found;
      return yield* project.list({ branch: branch === "" ? undefined : branch }).pipe(
        Effect.map((deployments): DeploymentListResult => ({
          status: "linked",
          provider: driver.kind,
          projectName: project.name,
          deployments,
        })),
        Effect.catchIf(
          (error) => error.reason === "missing-cli" || error.reason === "unauthenticated",
          (error) =>
            Effect.succeed<DeploymentListResult>({
              status: "unavailable",
              provider: driver.kind,
              projectName: project.name,
              reason: error.reason === "missing-cli" ? "missing-cli" : "unauthenticated",
              hint:
                error.reason === "missing-cli"
                  ? driver.hints.missingCli
                  : driver.hints.unauthenticated,
            }),
        ),
      );
    }),
    {
      capacity: LIST_CACHE_CAPACITY,
      timeToLive: (exit) =>
        Exit.isFailure(exit)
          ? Duration.zero
          : hasActiveDeployment(exit.value)
            ? ACTIVE_LIST_CACHE_TTL
            : LIST_CACHE_TTL,
    },
  );

  return DeploymentService.of({
    discover: Effect.forEach(drivers, ({ instance }) => instance.discover, {
      concurrency: "unbounded",
    }).pipe(Effect.map((providers) => ({ providers }))),
    list: Effect.fn("DeploymentService.list")(function* (input) {
      const key = `${input.projectId}${KEY_SEPARATOR}${input.branch ?? ""}`;
      if (input.fresh === true) yield* Cache.invalidate(listCache, key);
      return yield* Cache.get(listCache, key);
    }),
    logs: Effect.fn("DeploymentService.logs")(function* (input) {
      const found = yield* projectFor(input.projectId);
      if (found === null) return yield* new DeploymentError({ reason: "unlinked" });
      return yield* found.project.logs(input);
    }),
  });
});

export const layer = Layer.effect(DeploymentService, make);
