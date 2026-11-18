import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import type { DeploymentHostname } from "@t3tools/contracts";
import {
  DeploymentHost,
  DeploymentProcessError,
  type DeploymentProcessOutput,
} from "@t3tools/deployment-core/server/DeploymentHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as VercelDeployments from "./VercelDeployments.ts";

type Answer = Partial<DeploymentProcessOutput> | DeploymentProcessError;
const isProcessError = Schema.is(DeploymentProcessError);

function fakeVercel(answer: (args: ReadonlyArray<string>) => Answer) {
  const invocations: Array<ReadonlyArray<string>> = [];
  const layer = Layer.merge(
    NodeFileSystem.layer,
    Layer.succeed(DeploymentHost, {
      process: {
        run: (input) =>
          Effect.suspend(() => {
            invocations.push(input.args);
            const result = answer(input.args);
            return isProcessError(result)
              ? Effect.fail(result)
              : Effect.succeed({
                  exitCode: 0,
                  stdout: "",
                  stderr: "",
                  truncated: false,
                  ...result,
                });
          }),
      },
    }),
  );
  return { layer, invocations };
}

const linkedCheckout = Effect.fn("linkedCheckout")(function* (orgId: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-vercel-" });
  yield* fileSystem.makeDirectory(`${root}/.vercel`);
  yield* fileSystem.writeFileString(
    `${root}/.vercel/project.json`,
    JSON.stringify({ projectId: "prj_1", orgId, projectName: "storefront" }),
  );
  return root;
});

const hostname = "a.vercel.app" as DeploymentHostname;
const signedIn = '{"username":"octocat"}';
const emptyList = '{"deployments":[]}';

describe("Vercel deployments", () => {
  it.effect("never runs a command that would start a login when signed out", () => {
    const vercel = fakeVercel((args) =>
      args[0] === "whoami" ? { exitCode: 1, stdout: '{"loggedIn":false}' } : {},
    );
    return Effect.gen(function* () {
      const provider = yield* VercelDeployments.make;
      const project = yield* provider.projectFor(yield* linkedCheckout("team_1"));
      const listError = yield* Effect.flip(project!.list({}));
      const logsError = yield* Effect.flip(project!.logs({ hostname, source: "build" }));
      assert.strictEqual(listError.reason, "unauthenticated");
      assert.strictEqual(logsError.reason, "unauthenticated");
      assert.deepStrictEqual(vercel.invocations, [["whoami", "--json"]]);
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("lists a team project's branch by id, scoped to the team", () => {
    const vercel = fakeVercel((args) => ({ stdout: args[0] === "whoami" ? signedIn : emptyList }));
    return Effect.gen(function* () {
      const provider = yield* VercelDeployments.make;
      const project = yield* provider.projectFor(yield* linkedCheckout("team_1"));
      assert.strictEqual(project!.name, "storefront");
      assert.deepStrictEqual(yield* project!.list({ branch: "checkout" }), []);
      assert.deepStrictEqual(vercel.invocations.at(-1), [
        "ls",
        "prj_1",
        "--json",
        "--limit",
        "20",
        "--scope",
        "team_1",
        "--meta",
        "githubCommitRef=checkout",
      ]);
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("leaves a personal account unscoped and repeats what the CLI said went wrong", () => {
    const vercel = fakeVercel((args) =>
      args[0] === "whoami"
        ? { stdout: signedIn }
        : {
            exitCode: 1,
            stdout: '{"status":"error","reason":"project_not_found","message":"No such project."}',
          },
    );
    return Effect.gen(function* () {
      const provider = yield* VercelDeployments.make;
      const project = yield* provider.projectFor(yield* linkedCheckout("user1"));
      const error = yield* Effect.flip(project!.list({}));
      assert.strictEqual(error.reason, "failed");
      assert.strictEqual(error.detail, "No such project.");
      assert.strictEqual(vercel.invocations.at(-1)?.includes("--scope"), false);
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("reads a failed deployment's build log although the CLI exits 1 for it", () => {
    const vercel = fakeVercel((args) => {
      if (args[0] === "whoami") return { stdout: signedIn };
      return args.includes("--logs")
        ? { exitCode: 1, stdout: '[{"created":0,"text":"Build failed","level":"error"}]' }
        : { exitCode: 1, stdout: '{"readyState":"ERROR"}' };
    });
    return Effect.gen(function* () {
      const provider = yield* VercelDeployments.make;
      const project = yield* provider.projectFor(yield* linkedCheckout("team_1"));
      assert.deepStrictEqual(yield* project!.logs({ hostname, source: "build" }), {
        lines: [{ at: "1970-01-01T00:00:00.000Z", level: "error", text: "Build failed" }],
        truncated: false,
        nextCursor: null,
        live: false,
      });
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("marks a build log live while the deployment is still building", () => {
    const vercel = fakeVercel((args) => {
      if (args[0] === "whoami") return { stdout: signedIn };
      return { stdout: args.includes("--logs") ? "[]" : '{"readyState":"BUILDING"}' };
    });
    return Effect.gen(function* () {
      const provider = yield* VercelDeployments.make;
      const project = yield* provider.projectFor(yield* linkedCheckout("team_1"));
      const page = yield* project!.logs({ hostname, source: "build" });
      assert.strictEqual(page.live, true);
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("claims no checkout without a project link and reports a missing CLI", () => {
    const vercel = fakeVercel(() => new DeploymentProcessError({ reason: "missing-tool" }));
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const provider = yield* VercelDeployments.make;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-vercel-" });
      assert.strictEqual(yield* provider.projectFor(root), null);
      const item = yield* provider.discover;
      assert.strictEqual(item.status, "missing");
      assert.strictEqual(item.auth, "unknown");
      const project = yield* provider.projectFor(yield* linkedCheckout("team_1"));
      const error = yield* Effect.flip(project!.list({}));
      assert.strictEqual(error.reason, "missing-tool");
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });
});
