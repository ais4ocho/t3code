import { describe, expect, it } from "vite-plus/test";

import { deploymentBuildDuration } from "./deploymentPresentation.ts";

describe("deploymentBuildDuration", () => {
  it("is null until the deployment is ready", () => {
    const createdAt = "2026-11-13T19:38:31.000Z";
    expect(deploymentBuildDuration({ createdAt })).toBeNull();
    expect(deploymentBuildDuration({ createdAt, readyAt: "2026-11-13T19:40:25.000Z" })).toBe(
      "1m 54s",
    );
    expect(deploymentBuildDuration({ createdAt, readyAt: "2026-11-13T19:38:30.000Z" })).toBeNull();
  });
});
