// @effect-diagnostics nodeBuiltinImport:off -- fixtures are captured CLI output on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

import {
  parseBuildLogs,
  parseCliErrorReason,
  parseDeploymentList,
  parseProjectLink,
  parseRuntimeLogs,
  parseWhoami,
} from "./vercelJson.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "../../test/fixtures", name), "utf8");

describe("vercelJson", () => {
  it("reads a deployment list and leaves out states it does not know", () => {
    const list = parseDeploymentList(fixture("ls.json"));
    assert.strictEqual(list?.projectName, "storefront");
    assert.deepStrictEqual(
      list?.deployments.map((deployment) => [
        deployment.hostname,
        deployment.state,
        deployment.target,
        deployment.branch,
      ]),
      [
        ["storefront-re2dxyute-acme.vercel.app", "ready", "production", "main"],
        ["storefront-jlik23lxu-acme.vercel.app", "building", "preview", "checkout"],
        ["storefront-1mv84eynf-acme.vercel.app", "ready", "production", "main"],
      ],
    );
    const [first, building] = list!.deployments;
    assert.strictEqual(first!.commitTitle, "Merge pull request #7 from acme/checkout");
    assert.strictEqual(first!.commitSha, "0000000000000000000000000000000000000001");
    assert.strictEqual(first!.creator, "octocat");
    assert.strictEqual(first!.createdAt, "2026-11-13T19:38:31.566Z");
    assert.strictEqual(building!.readyAt, undefined);
  });

  it("tells an error object and other output from a list", () => {
    const error = '{"status":"error","reason":"project_not_found","message":"no project"}';
    assert.strictEqual(parseDeploymentList(error), null);
    assert.strictEqual(parseCliErrorReason(error), "project_not_found");
    assert.strictEqual(parseDeploymentList("Error: nope"), null);
    assert.strictEqual(parseCliErrorReason("Error: nope"), undefined);
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

  it("reads build logs past the CLI's banner", () => {
    const page = parseBuildLogs(fixture("build-logs.txt"), false);
    assert.strictEqual(page.lines.length, 6);
    assert.deepStrictEqual(page.lines[0], {
      at: "2026-11-13T19:38:32.269Z",
      text: "Running build in Washington, D.C., USA (East) – iad1",
    });
    const cut = parseBuildLogs(
      "2026-11-13T19:38:33.199Z  Cloning completed\n2026-11-13T19:38:3",
      true,
    );
    assert.deepStrictEqual(cut, {
      lines: [{ at: "2026-11-13T19:38:33.199Z", text: "Cloning completed" }],
      truncated: true,
    });
    const long = Array.from(
      { length: 1_600 },
      (_, index) => `2026-11-13T19:38:33.199Z  line ${index}`,
    );
    const tail = parseBuildLogs(long.join("\n"), false);
    assert.strictEqual(tail.truncated, true);
    assert.strictEqual(tail.lines.at(-1)?.text, "line 1599");
    assert.strictEqual(tail.lines.length, 1_500);
  });

  it("reads runtime logs oldest first with the cursor for the next page", () => {
    const page = parseRuntimeLogs(fixture("runtime-logs.jsonl"), false);
    assert.deepStrictEqual(
      page.lines.map((line) => [line.level, line.text.split("\n", 1)[0]]),
      [
        ["info", "Rendered /cart"],
        ["warning", "Slow query"],
        ["error", "Cart failed to load Error: upstream 401"],
      ],
    );
    assert.strictEqual(page.next, "eyJ2IjoxfQ");
  });
});
