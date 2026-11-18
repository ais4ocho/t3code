import * as NodeUtil from "node:util";
import {
  type Deployment,
  DeploymentHostname,
  DeploymentProviderKind,
  type DeploymentAuthStatus,
  type DeploymentLogLine,
  type DeploymentState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const VERCEL = DeploymentProviderKind.make("vercel");

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const RawProjectLink = Schema.Struct({
  projectId: Schema.String,
  orgId: Schema.String,
  projectName: Schema.optional(Schema.String),
});
const decodeProjectLink = Schema.decodeUnknownOption(Schema.fromJsonString(RawProjectLink));

export interface VercelProjectLink {
  readonly projectId: string;
  readonly orgId: string;
  readonly projectName: string | undefined;
}

/** `.vercel/project.json`, which `vercel link` writes. */
export function parseProjectLink(text: string): VercelProjectLink | null {
  return decodeProjectLink(text).pipe(
    // The ids become CLI arguments.
    Option.filter((link) => /^[A-Za-z0-9_]+$/u.test(link.projectId)),
    Option.filter((link) => /^[A-Za-z0-9_]+$/u.test(link.orgId)),
    Option.map((link) => ({ ...link, projectName: nonEmpty(link.projectName) })),
    Option.getOrNull,
  );
}

const RawWhoami = Schema.Struct({
  loggedIn: Schema.optional(Schema.Boolean),
  username: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeWhoami = Schema.decodeUnknownOption(Schema.fromJsonString(RawWhoami));

export function parseWhoami(stdout: string): {
  readonly auth: DeploymentAuthStatus;
  readonly account: string | undefined;
} {
  const whoami = Option.getOrUndefined(decodeWhoami(stdout));
  if (whoami === undefined) return { auth: "unknown", account: undefined };
  const account = nonEmpty(whoami.username ?? undefined);
  if (whoami.loggedIn === false) return { auth: "unauthenticated", account: undefined };
  return account === undefined ? { auth: "unknown", account } : { auth: "authenticated", account };
}

const RawDeployment = Schema.Struct({
  url: Schema.String,
  name: Schema.optional(Schema.String),
  state: Schema.String,
  target: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  ready: Schema.optional(Schema.NullOr(Schema.Number)),
  creator: Schema.optional(
    Schema.NullOr(Schema.Struct({ username: Schema.optional(Schema.String) })),
  ),
  meta: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
});
const decodeDeployment = Schema.decodeUnknownOption(RawDeployment);
const decodeDeploymentList = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ deployments: Schema.Array(Schema.Unknown) })),
);
const isHostname = Schema.is(DeploymentHostname);

const STATES: Readonly<Record<string, DeploymentState>> = {
  QUEUED: "queued",
  INITIALIZING: "building",
  BUILDING: "building",
  READY: "ready",
  ERROR: "error",
  CANCELED: "canceled",
};

// Vercel names the commit fields after the git host the project is connected to.
const GIT_HOSTS = ["github", "gitlab", "bitbucket"] as const;

function gitMeta(meta: Readonly<Record<string, unknown>>, field: string): string | undefined {
  for (const host of GIT_HOSTS) {
    const value = meta[`${host}${field}`];
    if (typeof value === "string") {
      const trimmed = nonEmpty(value);
      if (trimmed !== undefined) return trimmed;
    }
  }
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function isoTime(milliseconds: number): string | undefined {
  return DateTime.make(milliseconds).pipe(Option.map(DateTime.formatIso), Option.getOrUndefined);
}

function deploymentFrom(raw: unknown): Deployment | null {
  const row = Option.getOrUndefined(decodeDeployment(raw));
  if (row === undefined) return null;
  // A state this build does not know, such as a deleted deployment, is left out.
  const state = STATES[row.state];
  const createdAt = isoTime(row.createdAt);
  if (state === undefined || createdAt === undefined || !isHostname(row.url)) return null;
  const meta = row.meta ?? {};
  return {
    provider: VERCEL,
    hostname: row.url,
    state,
    target: row.target === "production" ? "production" : "preview",
    createdAt,
    readyAt: row.ready == null ? undefined : isoTime(row.ready),
    branch: gitMeta(meta, "CommitRef"),
    commitSha: gitMeta(meta, "CommitSha"),
    commitTitle: nonEmpty(gitMeta(meta, "CommitMessage")?.split("\n", 1)[0]?.slice(0, 200)),
    creator: nonEmpty(row.creator?.username),
  };
}

/** `vercel ls --json`. Null when the output is not a deployment list at all. */
export function parseDeploymentList(stdout: string): {
  readonly projectName: string | undefined;
  readonly deployments: ReadonlyArray<Deployment>;
} | null {
  const list = Option.getOrUndefined(decodeDeploymentList(stdout));
  if (list === undefined) return null;
  const deployments: Deployment[] = [];
  for (const raw of list.deployments) {
    const deployment = deploymentFrom(raw);
    if (deployment !== null) deployments.push(deployment);
  }
  const first = Option.getOrUndefined(decodeDeployment(list.deployments[0]));
  return { projectName: nonEmpty(first?.name), deployments };
}

const RawCliError = Schema.Struct({
  status: Schema.Literal("error"),
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
const decodeCliError = Schema.decodeUnknownOption(Schema.fromJsonString(RawCliError));

const MAX_DETAIL_LENGTH = 300;

/**
 * Why a command's output is no use, in the CLI's own words: the error object it prints on stdout
 * under `--json`, else the last thing it wrote to stderr.
 */
export function cliFailureDetail(output: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}): string {
  const error = Option.getOrUndefined(decodeCliError(output.stdout));
  const said =
    nonEmpty(error?.message) ??
    nonEmpty(error?.reason) ??
    nonEmpty(NodeUtil.stripVTControlCharacters(output.stderr).trim().split(/\r?\n/u).at(-1));
  if (said !== undefined) return said.slice(0, MAX_DETAIL_LENGTH);
  return output.exitCode === 0
    ? "The Vercel CLI returned output T3 Code could not read."
    : `The Vercel CLI exited with code ${output.exitCode}.`;
}

const decodeReadyState = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ readyState: Schema.String })),
);

/** `vercel inspect --json`. Undefined for output that names no state this build knows. */
export function parseDeploymentState(stdout: string): DeploymentState | undefined {
  const deployment = Option.getOrUndefined(decodeReadyState(stdout));
  return deployment === undefined ? undefined : STATES[deployment.readyState];
}

export interface VercelLogLines {
  /** Oldest first. */
  readonly lines: ReadonlyArray<DeploymentLogLine>;
  /** Some lines were left out to keep the page small. */
  readonly truncated: boolean;
}

// A failed build explains itself at the end, so the newest lines are the ones kept.
const MAX_BUILD_LOG_LINES = 1_500;
const MAX_LOG_TEXT_LENGTH = 2_000;

const RawBuildEvent = Schema.Struct({
  created: Schema.optional(Schema.Number),
  text: Schema.optional(Schema.String),
  level: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeBuildEvent = Schema.decodeUnknownOption(RawBuildEvent);
const decodeBuildEvents = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);

function logText(text: string): string {
  return NodeUtil.stripVTControlCharacters(text).slice(0, MAX_LOG_TEXT_LENGTH);
}

function logLevel(level: string | null | undefined): DeploymentLogLine["level"] {
  if (level === "error" || level === "fatal") return "error";
  if (level === "warning" || level === "warn") return "warning";
  return undefined;
}

/** `vercel inspect --logs --json`: every build event so far, oldest first. Null when unreadable. */
export function parseBuildLogs(stdout: string): VercelLogLines | null {
  const events = Option.getOrUndefined(decodeBuildEvents(stdout));
  if (events === undefined) return null;
  const lines: DeploymentLogLine[] = [];
  for (const raw of events) {
    const event = Option.getOrUndefined(decodeBuildEvent(raw));
    if (event?.text === undefined) continue;
    lines.push({
      at: event.created === undefined ? undefined : isoTime(event.created),
      level: logLevel(event.level),
      text: logText(event.text),
    });
  }
  return {
    lines: lines.slice(-MAX_BUILD_LOG_LINES),
    truncated: lines.length > MAX_BUILD_LOG_LINES,
  };
}

const RawRuntimeRecord = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("log"),
    data: Schema.Struct({
      timestamp: Schema.optional(Schema.String),
      level: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("summary"),
    pagination: Schema.optional(
      Schema.Struct({
        hasMore: Schema.optional(Schema.Boolean),
        next: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  }),
]);
const decodeRuntimeRecord = Schema.decodeUnknownOption(RawRuntimeRecord);

/**
 * `vercel logs --json`: JSON Lines, newest first, ending with a summary. `cutShort` output lost
 * its end, which is its oldest records and the summary.
 */
export function parseRuntimeLogs(
  stdout: string,
  cutShort: boolean,
): VercelLogLines & { readonly nextCursor: string | null } {
  const lines: DeploymentLogLine[] = [];
  let nextCursor: string | null = null;
  for (const row of stdout.split(/\r?\n/u)) {
    if (row.trim().length === 0) continue;
    const record = decodeJson(row).pipe(Option.flatMap(decodeRuntimeRecord), Option.getOrUndefined);
    if (record === undefined) continue;
    if (record.type === "summary") {
      if (record.pagination?.hasMore === true) nextCursor = record.pagination.next ?? null;
      continue;
    }
    lines.push({
      at: nonEmpty(record.data.timestamp),
      level: logLevel(record.data.level),
      text: logText(record.data.message ?? ""),
    });
  }
  lines.reverse();
  return { lines, truncated: cutShort, nextCursor };
}
