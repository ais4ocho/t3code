import { describe, expect, it } from "vite-plus/test";

import { deploymentsSearchFromUrl } from "./deploymentsSearch.logic";

describe("deploymentsSearchFromUrl", () => {
  it("replaces a malformed selection instead of letting the raw value through", () => {
    // The router lays the validated keys over the raw search, so a key left out keeps its raw value.
    const raw = {
      selectedEnvironmentId: true,
      selectedProjectId: "   ",
      deployment: "--token.vercel.app",
    };
    const search = { ...raw, ...deploymentsSearchFromUrl(raw) };
    expect(search.selectedEnvironmentId).toBeUndefined();
    expect(search.selectedProjectId).toBeUndefined();
    expect(search.deployment).toBeUndefined();
    expect(deploymentsSearchFromUrl({ deployment: "Storefront.vercel.app" }).deployment).toBe(
      undefined,
    );
  });

  it("reads a selection whose values the router parsed as numbers", () => {
    expect(
      deploymentsSearchFromUrl({
        selectedEnvironmentId: " environment-1 ",
        selectedProjectId: 42,
        deployment: "storefront-abc123.vercel.app",
      }),
    ).toEqual({
      selectedEnvironmentId: "environment-1",
      selectedProjectId: "42",
      deployment: "storefront-abc123.vercel.app",
    });
    expect(deploymentsSearchFromUrl({ deployment: 1234 }).deployment).toBe("1234");
  });
});
