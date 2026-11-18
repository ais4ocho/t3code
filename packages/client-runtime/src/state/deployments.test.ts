import {
  DeploymentProviderKind,
  EnvironmentId,
  ProjectId,
  type Deployment,
  type DeploymentHostname,
  type DeploymentListResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  deploymentListRefreshMs,
  listDeploymentsAcrossProjects,
  type ProjectDeployments,
} from "./deployments.ts";

const provider = DeploymentProviderKind.make("vercel");

const deployment = (
  name: string,
  createdAt: string,
  state: Deployment["state"] = "ready",
): Deployment => ({
  provider,
  hostname: `${name}.vercel.app` as DeploymentHostname,
  state,
  target: "preview",
  createdAt,
});

const linked = (
  projectName: string,
  deployments: ReadonlyArray<Deployment>,
): Extract<DeploymentListResult, { status: "linked" }> => ({
  status: "linked",
  provider,
  projectName,
  deployments,
});

describe("deploymentListRefreshMs", () => {
  it("reads again sooner while a deployment is in progress", () => {
    const quiet = linked("storefront", [deployment("a", "2026-11-13T10:00:00.000Z")]);
    const busy = linked("storefront", [
      deployment("b", "2026-11-13T11:00:00.000Z", "building"),
      ...quiet.deployments,
    ]);
    const quietMs = deploymentListRefreshMs(Option.some(quiet));
    expect(deploymentListRefreshMs(Option.some(busy))).toBeLessThan(quietMs);
    expect(deploymentListRefreshMs(Option.none())).toBe(quietMs);
  });
});

describe("listDeploymentsAcrossProjects", () => {
  it("orders every project's deployments newest first, each once, and skips unreadable projects", () => {
    const target = (projectId: string) => ({
      environmentId: EnvironmentId.make("environment-1"),
      input: { projectId: ProjectId.make(projectId) },
    });
    const projects: ReadonlyArray<ProjectDeployments> = [
      {
        target: target("project-1"),
        result: linked("storefront", [
          deployment("a3", "2026-11-13T12:00:00.000Z"),
          deployment("a1", "2026-11-13T10:00:00.000Z"),
        ]),
      },
      {
        target: target("project-2"),
        result: {
          status: "unavailable",
          provider,
          projectName: "docs",
          reason: "unauthenticated",
          hint: "Sign in.",
        },
      },
      {
        target: target("project-3"),
        result: linked("blog", [deployment("b2", "2026-11-13T11:00:00.000Z")]),
      },
      {
        target: target("project-4"),
        result: linked("storefront", [deployment("a3", "2026-11-13T12:00:00.000Z")]),
      },
    ];
    expect(
      listDeploymentsAcrossProjects(projects).map((entry) => [
        entry.projectName,
        entry.projectId,
        entry.deployment.hostname,
      ]),
    ).toEqual([
      ["storefront", "project-1", "a3.vercel.app"],
      ["blog", "project-3", "b2.vercel.app"],
      ["storefront", "project-1", "a1.vercel.app"],
    ]);
  });
});
