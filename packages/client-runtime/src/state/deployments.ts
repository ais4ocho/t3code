import {
  WS_METHODS,
  type Deployment,
  type DeploymentListInput,
  type DeploymentListResult,
  type EnvironmentId,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

function isDeploymentInProgress(deployment: Pick<Deployment, "state">): boolean {
  return deployment.state === "queued" || deployment.state === "building";
}

/** A build moves through its states, and writes its log, within seconds. */
export const DEPLOYMENT_IN_PROGRESS_REFRESH_MS = 12_000;
// Nothing announces a push that starts a deployment, so a quiet list is still read now and then.
const QUIET_LIST_REFRESH_MS = 60_000;

/**
 * How long a view may show a project's deployment list before reading it again; null when
 * nothing but a new link can change it. A list not read yet, or one that failed, is tried again
 * at the quiet pace.
 */
export function deploymentListRefreshMs(list: DeploymentListResult | null): number | null {
  if (list?.status === "unlinked") return null;
  return list?.status === "linked" && list.deployments.some(isDeploymentInProgress)
    ? DEPLOYMENT_IN_PROGRESS_REFRESH_MS
    : QUIET_LIST_REFRESH_MS;
}

/**
 * Every read spawns the provider's CLI on the server, so nothing here reads on a timer of its
 * own: each client refreshes at the pace above while its view is on screen and in use.
 */
export function createDeploymentEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  return {
    /** The providers the server could read, for Settings. */
    providers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:deployments:providers",
      tag: WS_METHODS.deploymentsDiscover,
      staleTimeMs: 30_000,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:deployments:list",
      tag: WS_METHODS.deploymentsList,
      staleTimeMs: 30_000,
    }),
    /** The newest page of a deployment's logs. */
    logs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:deployments:logs",
      tag: WS_METHODS.deploymentsLogs,
      staleTimeMs: 30_000,
    }),
    /** An older page past a cursor, run as a command: the panel prepends what arrives. */
    olderLogs: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:deployments:older-logs",
      tag: WS_METHODS.deploymentsLogs,
      scheduler: commandScheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => JSON.stringify([environmentId, input]),
      },
    }),
  };
}

export interface DeploymentListTarget {
  readonly environmentId: EnvironmentId;
  readonly input: DeploymentListInput;
}

/** One project's deployments, placed by the environment and project they were read from. */
export interface ProjectDeployments {
  readonly target: DeploymentListTarget;
  readonly result: Exclude<DeploymentListResult, { readonly status: "unlinked" }>;
}

export interface MergedDeploymentLists {
  /** The projects a provider claims, in target order. Projects with no provider are left out. */
  readonly projects: ReadonlyArray<ProjectDeployments>;
  /** The first project that failed outright; the others may still have answered. */
  readonly error: string | null;
  readonly isPending: boolean;
  /** Some project has yet to answer, so "nothing linked" cannot be told from "still reading". */
  readonly isLoading: boolean;
}

const NO_DEPLOYMENT_LISTS: MergedDeploymentLists = {
  projects: [],
  error: null,
  isPending: false,
  isLoading: false,
};

/**
 * Many projects' lists read at once: React cannot subscribe to a list of atoms whose length
 * changes, so the fan-out lives in one derived atom keyed by the targets. A project that fails
 * contributes nothing rather than blanking the others.
 */
export function createMergedDeploymentListAtoms<E>(
  list: (
    target: DeploymentListTarget,
  ) => Atom.Atom<AsyncResult.AsyncResult<DeploymentListResult, E>>,
  formatError: (cause: Cause.Cause<E>) => string,
) {
  const empty = Atom.make(NO_DEPLOYMENT_LISTS).pipe(
    Atom.withLabel("deployments:merged-list:empty"),
  );
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedDeploymentLists => {
      const projects: Array<ProjectDeployments> = [];
      let error: string | null = null;
      let isPending = false;
      let answered = 0;
      const targets = JSON.parse(key) as ReadonlyArray<DeploymentListTarget>;
      for (const target of targets) {
        const result = get(list(target));
        isPending ||= result.waiting;
        if (result._tag === "Failure" && error === null) error = formatError(result.cause);
        if (result._tag !== "Initial") answered += 1;
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null && value.status !== "unlinked") projects.push({ target, result: value });
      }
      return { projects, error, isPending, isLoading: answered < targets.length && isPending };
    }).pipe(Atom.withLabel(`deployments:merged-list:${key}`)),
  );
  return {
    atom: (targets: ReadonlyArray<DeploymentListTarget>) =>
      targets.length === 0 ? empty : family(JSON.stringify(targets)),
    refresh: (
      registry: AtomRegistry.AtomRegistry,
      targets: ReadonlyArray<DeploymentListTarget>,
    ) => {
      for (const target of targets) registry.refresh(list(target));
    },
  };
}

/** The projects with a deployment in progress, which a list across projects reads more often. */
export function deploymentTargetsInProgress(
  projects: ReadonlyArray<ProjectDeployments>,
): ReadonlyArray<DeploymentListTarget> {
  return projects.flatMap(({ target, result }) =>
    result.status === "linked" && result.deployments.some(isDeploymentInProgress) ? [target] : [],
  );
}

/** A deployment with the project it belongs to, as a list across projects shows it. */
export interface ListedDeployment {
  readonly environmentId: EnvironmentId;
  readonly projectId: DeploymentListInput["projectId"];
  /** The project's name at the provider. */
  readonly projectName: string;
  readonly deployment: Deployment;
}

/**
 * Every project's deployments as one list, newest first. Two checkouts of one repository are two
 * projects linked to the same provider project, so a deployment both report is listed once, under
 * the first.
 */
export function listDeploymentsAcrossProjects(
  projects: ReadonlyArray<ProjectDeployments>,
): ReadonlyArray<ListedDeployment> {
  const listed: Array<ListedDeployment> = [];
  const seen = new Set<string>();
  for (const { target, result } of projects) {
    if (result.status !== "linked") continue;
    for (const deployment of result.deployments) {
      if (seen.has(deployment.hostname)) continue;
      seen.add(deployment.hostname);
      listed.push({
        environmentId: target.environmentId,
        projectId: target.input.projectId,
        projectName: result.projectName,
        deployment,
      });
    }
  }
  return listed.sort(
    (a, b) => Date.parse(b.deployment.createdAt) - Date.parse(a.deployment.createdAt),
  );
}
