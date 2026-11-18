import * as NodeUtil from "node:util";
import {
  type Deployment,
  DeploymentHostname,
  type DeploymentAuthStatus,
  type DeploymentLogLine,
  type DeploymentLogPage,
  type DeploymentState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
  const readyAt = row.ready == null ? undefined : isoTime(row.ready);
  const branch = gitMeta(meta, "CommitRef");
  const commitSha = gitMeta(meta, "CommitSha");
  const commitTitle = nonEmpty(gitMeta(meta, "CommitMessage")?.split("\n", 1)[0]?.slice(0, 200));
  const creator = nonEmpty(row.creator?.username);
  return {
    provider: "vercel",
    hostname: row.url,
    state,
    target: row.target === "production" ? "production" : "preview",
    createdAt,
    ...(readyAt === undefined ? {} : { readyAt }),
    ...(branch === undefined ? {} : { branch }),
    ...(commitSha === undefined ? {} : { commitSha }),
    ...(commitTitle === undefined ? {} : { commitTitle }),
    ...(creator === undefined ? {} : { creator }),
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

const RawCliError = Schema.Struct({ status: Schema.Literal("error"), reason: Schema.String });
const decodeCliError = Schema.decodeUnknownOption(Schema.fromJsonString(RawCliError));

/** The `reason` of the error object the CLI prints on stdout under `--json`. */
export function parseCliErrorReason(stdout: string): string | undefined {
  return Option.getOrUndefined(decodeCliError(stdout))?.reason;
}

const BUILD_LOG_LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) {2}(.*)$/u;
// A failed build explains itself at the end, so the newest lines are the ones kept.
const MAX_BUILD_LOG_LINES = 1_500;
const MAX_LOG_TEXT_LENGTH = 2_000;

/**
 * `vercel inspect --logs`, which prints to stderr: a banner, one timestamped line per log line,
 * then the deployment's status. `cutShort` output lost its end, so its last line is a fragment.
 */
export function parseBuildLogs(stderr: string, cutShort: boolean): DeploymentLogPage {
  const lines: DeploymentLogLine[] = [];
  const rows = NodeUtil.stripVTControlCharacters(stderr).split(/\r?\n/u);
  for (const row of cutShort ? rows.slice(0, -1) : rows) {
    const match = BUILD_LOG_LINE.exec(row);
    if (match !== null) {
      lines.push({ at: match[1]!, text: match[2]!.slice(0, MAX_LOG_TEXT_LENGTH) });
    }
    // Before the first timestamp is the CLI's own banner; after it, a line that wrapped or the
    // CLI's closing `status` row.
    else if (lines.length > 0 && row.trim().length > 0 && !row.startsWith("status\t")) {
      lines.push({ text: row.slice(0, MAX_LOG_TEXT_LENGTH) });
    }
  }
  return {
    lines: lines.slice(-MAX_BUILD_LOG_LINES),
    truncated: cutShort || lines.length > MAX_BUILD_LOG_LINES,
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

function runtimeLevel(level: string | undefined): NonNullable<DeploymentLogLine["level"]> {
  if (level === "error" || level === "fatal") return "error";
  if (level === "warning" || level === "warn") return "warning";
  return "info";
}

/** `vercel logs --json`: JSON Lines, newest first, ending with a summary. */
export function parseRuntimeLogs(stdout: string, cutShort: boolean): DeploymentLogPage {
  const lines: DeploymentLogLine[] = [];
  let next: string | undefined;
  for (const row of stdout.split(/\r?\n/u)) {
    if (row.trim().length === 0) continue;
    const record = decodeJson(row).pipe(Option.flatMap(decodeRuntimeRecord), Option.getOrUndefined);
    if (record === undefined) continue;
    if (record.type === "summary") {
      if (record.pagination?.hasMore === true) next = record.pagination.next ?? undefined;
      continue;
    }
    const at = nonEmpty(record.data.timestamp);
    lines.push({
      ...(at === undefined ? {} : { at }),
      level: runtimeLevel(record.data.level),
      text: (record.data.message ?? "").slice(0, MAX_LOG_TEXT_LENGTH),
    });
  }
  lines.reverse();
  return { lines, truncated: cutShort, ...(next === undefined ? {} : { next }) };
}
