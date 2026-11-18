import type { DeploymentProviderDiscoveryItem } from "@t3tools/contracts";
import { DeploymentHost } from "@t3tools/deployment-core/server/DeploymentHost";
import {
  type DeploymentProject,
  type DeploymentProviderApi,
  DeploymentProviderError,
} from "@t3tools/deployment-core/server/DeploymentProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  cliFailureDetail,
  parseBuildLogs,
  parseDeploymentList,
  parseDeploymentState,
  parseProjectLink,
  parseRuntimeLogs,
  parseWhoami,
  VERCEL,
  type VercelProjectLink,
} from "./vercelCliOutput.ts";

const EXECUTABLE = "vercel";
const LABEL = "Vercel";
const INSTALL_HINT = "Install the Vercel CLI with `npm i -g vercel`, then run `vercel login`.";
const SIGN_IN_HINT = "Run `vercel login` on the server to read this project's deployments.";
const LIST_LIMIT = "20";
const RUNTIME_LOG_LIMIT = "100";
// Build events arrive as one JSON array, which cannot be read once its end is cut off.
const BUILD_LOG_OUTPUT_BYTES = 16 * 1024 * 1024;
const RUNTIME_LOG_OUTPUT_BYTES = 4 * 1024 * 1024;

export const make = Effect.gen(function* () {
  const host = yield* DeploymentHost;
  const fileSystem = yield* FileSystem.FileSystem;

  const failure = (
    operation: string,
    reason: DeploymentProviderError["reason"],
    detail: string,
    cause?: unknown,
  ) => new DeploymentProviderError({ provider: VERCEL, operation, reason, detail, cause });

  const run = (input: {
    readonly operation: string;
    readonly cwd?: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs: number;
    readonly maxOutputBytes?: number;
  }) =>
    host.process
      .run({
        command: EXECUTABLE,
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes ?? 1024 * 1024,
      })
      .pipe(
        Effect.mapError((error) =>
          error.reason === "missing-tool"
            ? failure(input.operation, "missing-tool", "The Vercel CLI is not installed.", error)
            : failure(
                input.operation,
                "failed",
                error.reason === "timed-out"
                  ? `The Vercel CLI did not answer within ${input.timeoutMs / 1_000} seconds.`
                  : "The Vercel CLI could not be run.",
                error,
              ),
        ),
      );

  /** Fails on a non-zero exit with what the CLI said about it. */
  const runExpectingSuccess = (input: Parameters<typeof run>[0]) =>
    run(input).pipe(
      Effect.filterOrFail(
        (output) => output.exitCode === 0,
        (output) => failure(input.operation, "failed", cliFailureDetail(output)),
      ),
    );

  const whoami = run({ operation: "whoami", args: ["whoami", "--json"], timeoutMs: 10_000 }).pipe(
    Effect.map((output) => parseWhoami(output.stdout)),
  );

  // A signed-out `vercel` answers any other command by starting a device login and waiting for
  // it, so every read asks `whoami` first. Shared briefly so a burst of reads asks once.
  const requireSignIn = yield* whoami.pipe(
    Effect.flatMap(({ auth }) =>
      auth === "unauthenticated"
        ? Effect.fail(failure("whoami", "unauthenticated", "The Vercel CLI is signed out."))
        : Effect.void,
    ),
    Effect.cachedWithTTL("15 seconds"),
  );

  const discover = Effect.gen(function* () {
    const base = { kind: VERCEL, label: LABEL, executable: EXECUTABLE } as const;
    const version = yield* run({
      operation: "version",
      args: ["--version"],
      timeoutMs: 5_000,
    }).pipe(
      Effect.map((output) => output.stdout.trim().split(/\s+/u).at(-1) ?? ""),
      Effect.option,
    );
    if (version._tag === "None") {
      return {
        ...base,
        status: "missing",
        installHint: INSTALL_HINT,
        auth: "unknown",
      } satisfies DeploymentProviderDiscoveryItem;
    }
    const { auth, account } = yield* whoami.pipe(
      Effect.orElseSucceed(() => ({ auth: "unknown" as const, account: undefined })),
    );
    return {
      ...base,
      status: "available",
      version: version.value.length === 0 ? undefined : version.value,
      installHint: INSTALL_HINT,
      auth,
      account,
    } satisfies DeploymentProviderDiscoveryItem;
  });

  const projectAt = (workspaceRoot: string, link: VercelProjectLink): DeploymentProject => {
    // A personal account's id is not a scope the CLI accepts; its default scope already fits.
    const scope = link.orgId.startsWith("team_") ? ["--scope", link.orgId] : [];

    return {
      name: link.projectName ?? link.projectId,
      list: Effect.fn("VercelDeployments.list")(function* (input) {
        yield* requireSignIn;
        const output = yield* runExpectingSuccess({
          operation: "list",
          cwd: workspaceRoot,
          args: [
            "ls",
            link.projectId,
            "--json",
            "--limit",
            LIST_LIMIT,
            ...scope,
            // Only GitHub-connected projects carry this key, so a project on another git host
            // lists nothing for a branch.
            ...(input.branch === undefined ? [] : ["--meta", `githubCommitRef=${input.branch}`]),
          ],
          timeoutMs: 20_000,
        });
        const deployments = parseDeploymentList(output.stdout);
        if (deployments === null) {
          return yield* failure("list", "failed", cliFailureDetail(output));
        }
        return deployments;
      }),
      logs: Effect.fn("VercelDeployments.logs")(function* (input) {
        yield* requireSignIn;
        if (input.source === "build") {
          // The events say nothing about whether more will follow; the deployment's state does.
          // It is read first, so a deployment that says it has finished has written them all.
          // `vercel inspect` exits 1 for a failed or canceled deployment, so only its output
          // tells a failed read from a failed deployment.
          const deployment = yield* run({
            operation: "logs",
            cwd: workspaceRoot,
            args: ["inspect", input.hostname, "--json", ...scope],
            timeoutMs: 30_000,
          });
          const state = parseDeploymentState(deployment.stdout);
          if (state === null) {
            return yield* failure("logs", "failed", cliFailureDetail(deployment));
          }
          const events = yield* run({
            operation: "logs",
            cwd: workspaceRoot,
            args: ["inspect", input.hostname, "--logs", "--json", ...scope],
            timeoutMs: 30_000,
            maxOutputBytes: BUILD_LOG_OUTPUT_BYTES,
          });
          if (events.truncated) {
            return yield* failure("logs", "failed", "The build log is too large to read here.");
          }
          const page = parseBuildLogs(events.stdout);
          if (page === null) return yield* failure("logs", "failed", cliFailureDetail(events));
          return { ...page, nextCursor: null, live: state === "queued" || state === "building" };
        }
        const output = yield* runExpectingSuccess({
          operation: "logs",
          cwd: workspaceRoot,
          args:
            input.cursor === undefined
              ? [
                  "logs",
                  "--deployment",
                  input.hostname,
                  "--project",
                  link.projectId,
                  "--json",
                  "--since",
                  "24h",
                  "--limit",
                  RUNTIME_LOG_LIMIT,
                  ...scope,
                ]
              : // The cursor carries the target, the window and the team.
                ["logs", "--json", "--limit", RUNTIME_LOG_LIMIT, "--next", input.cursor],
          timeoutMs: 30_000,
          maxOutputBytes: RUNTIME_LOG_OUTPUT_BYTES,
        });
        return { ...parseRuntimeLogs(output.stdout, output.truncated), live: false };
      }),
    };
  };

  return {
    kind: VERCEL,
    hints: { toolMissing: INSTALL_HINT, unauthenticated: SIGN_IN_HINT },
    discover,
    projectFor: (workspaceRoot: string) =>
      fileSystem.readFileString(`${workspaceRoot}/.vercel/project.json`).pipe(
        Effect.map(parseProjectLink),
        Effect.map((link) => (link === null ? null : projectAt(workspaceRoot, link))),
        Effect.orElseSucceed(() => null),
      ),
  } satisfies DeploymentProviderApi;
});
