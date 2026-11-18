import { DeploymentHostname, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { DeploymentsSearch } from "./DeploymentsPage";

const isDeploymentHostname = Schema.is(DeploymentHostname);

// The router reads a bare `key=42` as a number.
const text = (value: unknown): unknown => (typeof value === "number" ? String(value) : value);

const bounded = (value: unknown): string | undefined => {
  const raw = text(value);
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 200) : undefined;
};

const hostname = (value: unknown): string | undefined => {
  const raw = text(value);
  return isDeploymentHostname(raw) ? raw : undefined;
};

// Every optional key is an own key, even when undefined: the router lays these over the parent
// route's unvalidated search, where a key left out would keep its raw value.
export const deploymentsSearchFromUrl = (raw: Record<string, unknown>): DeploymentsSearch => ({
  selectedEnvironmentId: bounded(raw.selectedEnvironmentId) as EnvironmentId | undefined,
  selectedProjectId: bounded(raw.selectedProjectId) as ProjectId | undefined,
  deployment: hostname(raw.deployment),
});
