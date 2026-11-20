import {
  type DeploymentListInput,
  type DeploymentListResult,
  type DeploymentLogPage,
  DeploymentProviderKind,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as DeploymentService from "../../../deployment/DeploymentService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as DeploymentsHandlers from "./handlers.ts";
import { DeploymentsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const VERCEL = DeploymentProviderKind.make("vercel");

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread: {
    threadId: THREAD_ID,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const linked: DeploymentListResult = {
  status: "linked",
  provider: VERCEL,
  projectName: "web",
  deployments: [
    {
      provider: VERCEL,
      hostname: "web-abc.vercel.app",
      state: "ready",
      target: "preview",
      createdAt: "2026-11-01T00:00:00.000Z",
      branch: "feature",
    },
  ],
};

const makeHarness = Effect.fn("makeDeploymentsToolkitHarness")(function* (
  options: { readonly list?: DeploymentListResult; readonly logs?: DeploymentLogPage } = {},
) {
  const lists = yield* Ref.make<ReadonlyArray<DeploymentListInput>>([]);
  const layerDependencies = Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: (id) =>
        Effect.succeed(
          id === THREAD_ID
            ? { ...McpToolAccessTestkit.liveThreadShell(id), projectId: PROJECT_ID }
            : null,
        ),
    }),
    Layer.mock(DeploymentService.DeploymentService)({
      list: (input) =>
        Ref.update(lists, (recorded) => [...recorded, input]).pipe(
          Effect.as(options.list ?? linked),
        ),
      logs: () =>
        Effect.succeed(
          options.logs ?? { lines: [], truncated: false, nextCursor: null, live: false },
        ),
    }),
  );
  const toolkit = yield* DeploymentsToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(DeploymentsHandlers.layer).pipe(
        Layer.provide(layerDependencies),
      ),
    ),
  );
  const call = <Name extends keyof typeof DeploymentsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["deployments"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof DeploymentsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(layerDependencies),
    );
  return { lists, call };
});

describe("deployment toolkit handlers", () => {
  it.effect("lists the thread's project without defaulting the branch", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("list_deployments", {});
      expect(yield* Ref.get(harness.lists)).toEqual([{ projectId: PROJECT_ID }]);
      expect(result).toEqual({
        status: "linked",
        projectName: "web",
        deployments: [
          {
            hostname: "web-abc.vercel.app",
            url: "https://web-abc.vercel.app",
            state: "ready",
            target: "preview",
            createdAt: "2026-11-01T00:00:00.000Z",
            branch: "feature",
          },
        ],
      });
    }),
  );

  it.effect("returns an unavailable list as a success carrying its hint", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        list: {
          status: "unavailable",
          provider: VERCEL,
          projectName: "web",
          reason: "unauthenticated",
          hint: "Run `vercel login` on the server.",
        },
      });
      const result = yield* harness.call("list_deployments", {});
      expect(result).toEqual({
        status: "unavailable",
        projectName: "web",
        deployments: [],
        reason: "unauthenticated",
        hint: "Run `vercel login` on the server.",
      });
    }),
  );

  it.effect("keeps the newest 300 build lines and cuts long line text", () =>
    Effect.gen(function* () {
      const lines = Array.from({ length: 400 }, (_, index) => ({ text: `line ${index}` }));
      const harness = yield* makeHarness({
        logs: {
          lines: [
            ...lines,
            { at: "2026-11-01T12:34:56.789Z", level: "error", text: "x".repeat(2_000) },
          ],
          truncated: false,
          nextCursor: "older",
          live: true,
        },
      });
      const result = yield* harness.call("read_deployment_logs", {
        hostname: "web-abc.vercel.app",
        source: "build",
      });
      const logLines = result.log.split("\n");
      expect(logLines).toHaveLength(300);
      expect(logLines[0]).toBe("line 101");
      expect(logLines.at(-1)).toBe(`12:34:56 error ${"x".repeat(500)}`);
      expect(result).toMatchObject({ truncated: true, live: true, nextCursor: "older" });
    }),
  );

  it.effect("refuses a credential without the deployments capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const refused = { _tag: "McpCapabilityUnavailableError", capability: "deployments" };
      expect(
        yield* harness
          .call("list_deployments", { projectId: PROJECT_ID }, ["issues"])
          .pipe(Effect.flip),
      ).toMatchObject(refused);
      expect(
        yield* harness
          .call(
            "read_deployment_logs",
            { projectId: PROJECT_ID, hostname: "web-abc.vercel.app", source: "runtime" },
            ["issues"],
          )
          .pipe(Effect.flip),
      ).toMatchObject(refused);
      expect(yield* Ref.get(harness.lists)).toEqual([]);
    }),
  );
});
