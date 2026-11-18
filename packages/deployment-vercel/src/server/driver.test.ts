import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import { DeploymentError, type DeploymentHostname } from "@t3tools/contracts";
import {
  DeploymentHost,
  type DeploymentProcessOutput,
} from "@t3tools/deployment-core/server/driver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { driver } from "./driver.ts";

type Answer = Partial<DeploymentProcessOutput> | DeploymentError;
const isDeploymentError = Schema.is(DeploymentError);

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
            return isDeploymentError(result)
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

const signedIn = '{"username":"octocat"}';
const emptyList = '{"deployments":[]}';

describe("Vercel deployment driver", () => {
  it.effect("never runs a command that would start a login when signed out", () => {
    const vercel = fakeVercel((args) =>
      args[0] === "whoami" ? { exitCode: 1, stdout: '{"loggedIn":false}' } : {},
    );
    return Effect.gen(function* () {
      const instance = yield* driver.make;
      const project = yield* instance.projectFor(yield* linkedCheckout("team_1"));
      const listError = yield* Effect.flip(project!.list({}));
      const logsError = yield* Effect.flip(
        project!.logs({ hostname: "a.vercel.app" as DeploymentHostname, source: "build" }),
      );
      assert.strictEqual(listError.reason, "unauthenticated");
      assert.strictEqual(logsError.reason, "unauthenticated");
      assert.deepStrictEqual(vercel.invocations, [["whoami", "--json"]]);
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("lists a team project's branch by id, scoped to the team", () => {
    const vercel = fakeVercel((args) => ({ stdout: args[0] === "whoami" ? signedIn : emptyList }));
    return Effect.gen(function* () {
      const instance = yield* driver.make;
      const project = yield* instance.projectFor(yield* linkedCheckout("team_1"));
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

  it.effect("leaves a personal account unscoped and reports a CLI error object", () => {
    const vercel = fakeVercel((args) =>
      args[0] === "whoami"
        ? { stdout: signedIn }
        : { exitCode: 1, stdout: '{"status":"error","reason":"project_not_found"}' },
    );
    return Effect.gen(function* () {
      const instance = yield* driver.make;
      const project = yield* instance.projectFor(yield* linkedCheckout("user1"));
      const error = yield* Effect.flip(project!.list({}));
      assert.strictEqual(error.reason, "failed");
      assert.strictEqual(vercel.invocations.at(-1)?.includes("--scope"), false);
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });

  it.effect("claims no checkout without a project link and reports a missing CLI", () => {
    const vercel = fakeVercel(() => new DeploymentError({ reason: "missing-cli" }));
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const instance = yield* driver.make;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-vercel-" });
      assert.strictEqual(yield* instance.projectFor(root), null);
      const item = yield* instance.discover;
      assert.strictEqual(item.status, "missing");
      assert.strictEqual(item.auth, "unknown");
    }).pipe(Effect.scoped, Effect.provide(vercel.layer));
  });
});
