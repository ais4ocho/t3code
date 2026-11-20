// @effect-diagnostics nodeBuiltinImport:off -- fixtures are captured CLI output on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Base64Url from "effect/encoding/Base64Url";

import {
  cliFailureDetail,
  logCursorReads,
  parseBuildLogs,
  parseDeploymentList,
  parseDeploymentState,
  parseProjectLink,
  parseRuntimeLogs,
  parseWhoami,
} from "./vercelCliOutput.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "../../test/fixtures", name), "utf8");

describe("vercelCliOutput", () => {
  it("reads a deployment list and leaves out states it does not know", () => {
    const deployments = parseDeploymentList(fixture("ls.json"));
    assert.deepStrictEqual(
      deployments?.map((deployment) => [
        deployment.hostname,
        deployment.state,
        deployment.target,
        deployment.branch,
      ]),
      [
        ["storefront-a1b2c3d4e-acme.vercel.app", "ready", "production", "main"],
        ["storefront-f5g6h7i8j-acme.vercel.app", "building", "preview", "checkout"],
        ["storefront-k9l0m1n2o-acme.vercel.app", "ready", "production", "main"],
        ["storefront-p3q4r5s6t-acme.vercel.app", "error", "preview", "checkout"],
      ],
    );
    const [first, building] = deployments!;
    assert.strictEqual(first!.commitTitle, "Merge pull request #7 from acme/checkout");
    assert.strictEqual(first!.commitSha, "0000000000000000000000000000000000000001");
    assert.strictEqual(first!.creator, "octocat");
    assert.strictEqual(first!.createdAt, "2026-11-13T19:38:31.566Z");
    assert.strictEqual(building!.readyAt, undefined);
  });

  it("tells an error object and other output from a list", () => {
    const error = '{"status":"error","reason":"project_not_found","message":"no project"}';
    assert.strictEqual(parseDeploymentList(error), null);
    assert.strictEqual(parseDeploymentList("Error: nope"), null);
  });

  it("explains a failure in the CLI's own words", () => {
    const failed = { exitCode: 1, stdout: "", stderr: "" };
    assert.strictEqual(
      cliFailureDetail({
        ...failed,
        stdout: '{"status":"error","reason":"project_not_found","message":"no project"}',
      }),
      "no project",
    );
    assert.strictEqual(
      cliFailureDetail({
        ...failed,
        stderr:
          "Vercel CLI 64.0.2\n\u001b[31mError:\u001b[39m The specified scope does not exist\nLearn More: https://err.sh/vercel/scope-not-existent\n",
      }),
      "Error: The specified scope does not exist",
    );
    assert.strictEqual(
      cliFailureDetail({
        ...failed,
        stderr:
          '{"status":"error","reason":"missing_scope","message":"Logs are available for team-owned projects only."}\n',
      }),
      "Logs are available for team-owned projects only.",
    );
    assert.strictEqual(cliFailureDetail({ ...failed, stderr: "nope\n" }), "nope");
    assert.strictEqual(cliFailureDetail(failed), "The Vercel CLI exited with code 1.");
    assert.strictEqual(
      cliFailureDetail({ ...failed, exitCode: 0 }),
      "The Vercel CLI returned output T3 Code could not read.",
    );
  });

  it("reads a deployment's state", () => {
    assert.strictEqual(parseDeploymentState('{"id":"dpl_1","readyState":"BUILDING"}'), "building");
    assert.strictEqual(parseDeploymentState('{"id":"dpl_1","readyState":"ERROR"}'), "error");
    assert.strictEqual(parseDeploymentState('{"id":"dpl_1","readyState":"DELETED"}'), undefined);
    assert.strictEqual(parseDeploymentState("Error: nope"), null);
  });

  it("reads who is signed in", () => {
    assert.deepStrictEqual(parseWhoami('{"team":null,"username":"octocat"}'), {
      auth: "authenticated",
      account: "octocat",
    });
    assert.deepStrictEqual(parseWhoami('{"loggedIn":false}'), {
      auth: "unauthenticated",
      account: undefined,
    });
    assert.deepStrictEqual(parseWhoami(""), { auth: "unknown", account: undefined });
  });

  it("reads a project link and refuses ids that are not plain ids", () => {
    assert.deepStrictEqual(
      parseProjectLink('{"projectId":"prj_1","orgId":"team_1","projectName":"storefront"}'),
      { projectId: "prj_1", orgId: "team_1", projectName: "storefront" },
    );
    assert.strictEqual(parseProjectLink('{"projectId":"--token","orgId":"team_1"}'), null);
    assert.strictEqual(parseProjectLink("not json"), null);
  });

  it("reads build events as lines and keeps the newest", () => {
    const page = parseBuildLogs(fixture("build-logs.json"));
    assert.deepStrictEqual(
      page?.lines.map((line) => [line.at, line.level, line.text]),
      [
        [
          "2026-11-13T19:38:32.269Z",
          undefined,
          "Running build in Washington, D.C., USA (East) – iad1",
        ],
        ["2026-11-13T19:38:33.199Z", undefined, "Cloning completed: 930.000ms"],
        ["2026-11-13T19:38:34.461Z", undefined, 'Running "vercel build"'],
        [
          "2026-11-13T19:38:40.100Z",
          "warning",
          "npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported",
        ],
        [
          "2026-11-13T19:39:20.000Z",
          "error",
          "Type error: Property 'total' does not exist on type 'Cart'.",
        ],
        ["2026-11-13T19:39:20.500Z", "error", 'Error: Command "npm run build" exited with 1'],
      ],
    );
    assert.strictEqual(page?.truncated, false);

    const long = JSON.stringify(
      Array.from({ length: 1_600 }, (_, index) => ({ created: 0, text: `line ${index}` })),
    );
    const tail = parseBuildLogs(long);
    assert.strictEqual(tail?.truncated, true);
    assert.strictEqual(tail?.lines.length, 1_500);
    assert.strictEqual(tail?.lines.at(-1)?.text, "line 1599");

    assert.strictEqual(parseBuildLogs("Error: Deployment not found"), null);
  });

  it("reads runtime logs oldest first with the cursor for the next page", () => {
    const page = parseRuntimeLogs(fixture("runtime-logs.jsonl"), false);
    assert.deepStrictEqual(
      page.lines.map((line) => [line.level, line.text.split("\n", 1)[0]]),
      [
        [undefined, "Rendered /cart"],
        ["warning", "Slow query"],
        ["error", "Cart failed to load Error: upstream 401"],
      ],
    );
    assert.strictEqual(page.nextCursor, "eyJ2IjoxfQ");
    assert.strictEqual(parseRuntimeLogs('{"type":"summary"}', true).nextCursor, null);
  });

  it("accepts a log cursor only for the linked project", () => {
    const link = { projectId: "prj_1", orgId: "team_1", projectName: undefined };
    const cursor = (payload: object) =>
      Base64Url.encode(JSON.stringify({ v: 1, cursor: "c", ...payload }));
    assert.isTrue(logCursorReads(cursor({ ownerId: "team_1", projectIds: ["prj_1"] }), link));
    assert.isFalse(logCursorReads(cursor({ ownerId: "team_2", projectIds: ["prj_1"] }), link));
    assert.isFalse(logCursorReads(cursor({ ownerId: "team_1", projectIds: ["prj_2"] }), link));
    assert.isFalse(
      logCursorReads(cursor({ ownerId: "team_1", projectIds: ["prj_1", "prj_2"] }), link),
    );
    assert.isFalse(logCursorReads("eyJ2IjoxfQ", link));
  });
});
