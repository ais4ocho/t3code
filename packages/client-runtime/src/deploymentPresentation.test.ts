import { describe, expect, it } from "vite-plus/test";

import {
  deploymentBuildDuration,
  deploymentStatePresentation,
  deploymentTitle,
} from "./deploymentPresentation.ts";

describe("deploymentTitle", () => {
  it("falls back to the hostname for a deployment made without a commit", () => {
    const hostname = "storefront-abc123-acme.vercel.app";
    expect(deploymentTitle({ hostname, commitTitle: "Fix the cart total" })).toBe(
      "Fix the cart total",
    );
    expect(deploymentTitle({ hostname })).toBe(hostname);
  });
});

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

describe("deploymentStatePresentation", () => {
  it("calls a deployment that errored failed", () => {
    expect(deploymentStatePresentation("error")).toEqual({ label: "Failed", tone: "failure" });
  });
});
