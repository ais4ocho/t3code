import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import { DeploymentHost } from "@t3tools/deployment-core/server/driver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProjectService from "../project/ProjectService.ts";
import * as DeploymentService from "./DeploymentService.ts";

const projectId = ProjectId.make("project-1");

const checkout = Effect.fn("checkout")(function* (linked: boolean) {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-deployments-" });
  if (linked) {
    yield* fileSystem.makeDirectory(`${root}/.vercel`);
    yield* fileSystem.writeFileString(
      `${root}/.vercel/project.json`,
      JSON.stringify({ projectId: "prj_1", orgId: "team_1", projectName: "storefront" }),
    );
  }
  return root;
});

function serviceFor(root: string, stdout: (args: ReadonlyArray<string>) => string) {
  const invocations: Array<string> = [];
  const layer = DeploymentService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeFileSystem.layer,
        Layer.mock(ProjectService.ProjectService)({
          getShell: () => Effect.succeedSome({ workspaceRoot: root } as OrchestrationProjectShell),
        }),
        Layer.succeed(DeploymentHost, {
          process: {
            run: (input) =>
              Effect.sync(() => {
                invocations.push(input.args[0]!);
                const text = stdout(input.args);
                return {
                  exitCode: text.includes('"loggedIn":false') ? 1 : 0,
                  stdout: text,
                  stderr: "",
                  truncated: false,
                };
              }),
          },
        }),
      ),
    ),
  );
  return { layer, invocations };
}

const list = (fresh?: boolean) =>
  DeploymentService.DeploymentService.pipe(
    Effect.flatMap((service) => service.list({ projectId, ...(fresh ? { fresh } : {}) })),
  );

describe("DeploymentService", () => {
  it.effect("reports a checkout no provider claims as unlinked without running a CLI", () =>
    Effect.gen(function* () {
      const service = serviceFor(yield* checkout(false), () => "");
      const result = yield* list().pipe(Effect.provide(service.layer));
      assert.deepStrictEqual(result, { status: "unlinked" });
      assert.deepStrictEqual(service.invocations, []);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("reports a signed-out CLI as unavailable with the provider's hint", () =>
    Effect.gen(function* () {
      const service = serviceFor(yield* checkout(true), () => '{"loggedIn":false}');
      const result = yield* list().pipe(Effect.provide(service.layer));
      assert.deepStrictEqual(result, {
        status: "unavailable",
        provider: "vercel",
        projectName: "storefront",
        reason: "unauthenticated",
        hint: "Run `vercel login` on the server to read this project's deployments.",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("shares one CLI read between readers until a fresh read is asked for", () =>
    Effect.gen(function* () {
      const service = serviceFor(yield* checkout(true), (args) =>
        args[0] === "whoami" ? '{"username":"octocat"}' : '{"deployments":[]}',
      );
      yield* Effect.gen(function* () {
        const first = yield* list();
        assert.strictEqual(first.status, "linked");
        yield* list();
        assert.deepStrictEqual(service.invocations, ["whoami", "ls"]);
        yield* list(true);
        assert.deepStrictEqual(service.invocations, ["whoami", "ls", "ls"]);
      }).pipe(Effect.provide(service.layer));
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );
});
