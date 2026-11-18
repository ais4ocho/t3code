import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DeploymentHostname, DeploymentLogsInput } from "./deployment.ts";

const isLogsInput = Schema.is(DeploymentLogsInput);
const isHostname = Schema.is(DeploymentHostname);

describe("DeploymentLogsInput", () => {
  const input = { projectId: "project-1", hostname: "a.vercel.app", source: "runtime" };

  it("refuses values a CLI would read as an option", () => {
    expect(isLogsInput({ ...input, cursor: "eyJ2IjoxfQ" })).toBe(true);
    expect(isLogsInput({ ...input, cursor: "--global-config=src" })).toBe(false);
    expect(isHostname("--token")).toBe(false);
  });
});
