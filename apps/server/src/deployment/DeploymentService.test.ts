import { assert, describe, it } from "@effect/vitest";
import {
  DeploymentProviderKind,
  ProjectId,
  type DeploymentHostname,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import {
  type DeploymentProject,
  type DeploymentProviderApi,
  DeploymentProviderError,
} from "@t3tools/deployment-core/server/DeploymentProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ProjectService from "../project/ProjectService.ts";
import * as DeploymentProviderRegistry from "./DeploymentProviderRegistry.ts";
import * as DeploymentService from "./DeploymentService.ts";

const projectId = ProjectId.make("project-1");
const kind = DeploymentProviderKind.make("fake");
const hostname = "a.example.app" as DeploymentHostname;

const failed = (reason: DeploymentProviderError["reason"], detail = "") =>
  new DeploymentProviderError({ provider: kind, operation: "list", reason, detail });

function serviceFor(project: Partial<DeploymentProject> | null) {
  const reads: Array<string> = [];
  const provider: DeploymentProviderApi = {
    kind,
    hints: { toolMissing: "Install the fake CLI.", unauthenticated: "Sign in to the fake CLI." },
    discover: Effect.die("not read"),
    projectFor: () =>
      Effect.succeed(
        project === null
          ? null
          : {
              name: "storefront",
              list: () => Effect.sync(() => void reads.push("list")).pipe(Effect.as([])),
              logs: () => Effect.die("not read"),
              ...project,
            },
      ),
  };
  const layer = DeploymentService.layer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          DeploymentProviderRegistry.DeploymentProviderRegistry,
          DeploymentProviderRegistry.fromProviders([provider]),
        ),
        Layer.mock(ProjectService.ProjectService)({
          getShell: () =>
            Effect.succeedSome({ workspaceRoot: "/checkout" } as OrchestrationProjectShell),
        }),
      ),
    ),
  );
  return { layer, reads };
}

const service = DeploymentService.DeploymentService;

describe("DeploymentService", () => {
  it.effect("reports a checkout no provider claims as unlinked", () => {
    const { layer } = serviceFor(null);
    return Effect.gen(function* () {
      const deployments = yield* service;
      assert.deepStrictEqual(yield* deployments.list({ projectId }), { status: "unlinked" });
      const error = yield* Effect.flip(deployments.logs({ projectId, hostname, source: "build" }));
      assert.strictEqual(error._tag, "DeploymentUnavailableError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("lists a provider it cannot use as unavailable, with the provider's hint", () => {
    const { layer } = serviceFor({ list: () => Effect.fail(failed("unauthenticated")) });
    return Effect.gen(function* () {
      const deployments = yield* service;
      assert.deepStrictEqual(yield* deployments.list({ projectId }), {
        status: "unavailable",
        provider: kind,
        projectName: "storefront",
        reason: "unauthenticated",
        hint: "Sign in to the fake CLI.",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails a read the provider refused with what the provider said", () => {
    const { layer } = serviceFor({ list: () => Effect.fail(failed("failed", "No such project.")) });
    return Effect.gen(function* () {
      const error = yield* Effect.flip((yield* service).list({ projectId }));
      assert.strictEqual(error.message, "Deployment operation list failed: No such project.");
    }).pipe(Effect.provide(layer));
  });

  it.effect("shares one read between readers that arrive together", () => {
    const { layer, reads } = serviceFor({});
    return Effect.gen(function* () {
      const deployments = yield* service;
      yield* deployments.list({ projectId });
      yield* deployments.list({ projectId });
      assert.deepStrictEqual(reads, ["list"]);
      yield* deployments.list({ projectId, branch: "checkout" });
      assert.deepStrictEqual(reads, ["list", "list"]);
      yield* TestClock.adjust("6 seconds");
      yield* deployments.list({ projectId });
      assert.deepStrictEqual(reads, ["list", "list", "list"]);
    }).pipe(Effect.provide(layer));
  });
});
