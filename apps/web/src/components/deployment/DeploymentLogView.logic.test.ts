import type { DeploymentLogPage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deploymentLogsWithOlder, prependOlderDeploymentLogs } from "./DeploymentLogView.logic";

const page = (texts: ReadonlyArray<string>, nextCursor: string | null): DeploymentLogPage => ({
  lines: texts.map((text) => ({ text })),
  truncated: false,
  nextCursor,
  live: false,
});

const shown = (first: DeploymentLogPage, held: Parameters<typeof deploymentLogsWithOlder>[1]) => {
  const { lines, nextCursor } = deploymentLogsWithOlder(first, held);
  return { texts: lines.map((line) => line.text), nextCursor };
};

describe("deploymentLogsWithOlder", () => {
  it("puts each older page in front and pages on from the oldest one", () => {
    const first = page(["e", "f"], "before-e");
    const one = prependOlderDeploymentLogs(first, null, page(["c", "d"], "before-c"));
    expect(shown(first, one)).toEqual({ texts: ["c", "d", "e", "f"], nextCursor: "before-c" });

    const two = prependOlderDeploymentLogs(first, one, page(["a", "b"], null));
    expect(shown(first, two)).toEqual({
      texts: ["a", "b", "c", "d", "e", "f"],
      nextCursor: null,
    });
  });

  it("starts over when the first page is read again", () => {
    const first = page(["e", "f"], "before-e");
    const held = prependOlderDeploymentLogs(first, null, page(["c", "d"], "before-c"));
    const refreshed = page(["e", "f", "g"], "before-e");
    expect(shown(refreshed, held)).toEqual({ texts: ["e", "f", "g"], nextCursor: "before-e" });

    const again = prependOlderDeploymentLogs(refreshed, held, page(["c", "d"], "before-c"));
    expect(shown(refreshed, again)).toEqual({
      texts: ["c", "d", "e", "f", "g"],
      nextCursor: "before-c",
    });
  });
});
