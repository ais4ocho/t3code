import { DeploymentError, type DeploymentProviderDiscoveryItem } from "@t3tools/contracts";
import {
  defineDeploymentDriver,
  DeploymentHost,
  type DeploymentProject,
} from "@t3tools/deployment-core/server/driver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  parseBuildLogs,
  parseCliErrorReason,
  parseDeploymentList,
  parseProjectLink,
  parseRuntimeLogs,
  parseWhoami,
  type VercelProjectLink,
} from "./vercelJson.ts";

const EXECUTABLE = "vercel";
const LABEL = "Vercel";
const INSTALL_HINT = "Install the Vercel CLI with `npm i -g vercel`, then run `vercel login`.";
const LIST_LIMIT = "20";
const RUNTIME_LOG_LIMIT = "100";
const LOG_OUTPUT_BYTES = 4 * 1024 * 1024;

const make = Effect.gen(function* () {
  const host = yield* DeploymentHost;
  const fileSystem = yield* FileSystem.FileSystem;

  const run = (input: {
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
        Effect.mapError((error) => new DeploymentError({ ...error, provider: "vercel" as const })),
      );

  const whoami = run({ args: ["whoami", "--json"], timeoutMs: 10_000 }).pipe(
    Effect.map((output) => parseWhoami(output.stdout)),
  );

  // A signed-out `vercel` answers any other command by starting a device login and waiting for
  // it, so every read asks `whoami` first. Shared briefly so a burst of reads asks once.
  const requireSignIn = yield* whoami.pipe(
    Effect.flatMap(({ auth }) =>
      auth === "unauthenticated"
        ? Effect.fail(new DeploymentError({ reason: "unauthenticated", provider: "vercel" }))
        : Effect.void,
    ),
    Effect.cachedWithTTL("15 seconds"),
  );

  const discover = Effect.gen(function* () {
    const base = { kind: "vercel", label: LABEL, executable: EXECUTABLE } as const;
    const version = yield* run({ args: ["--version"], timeoutMs: 5_000 }).pipe(
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
      ...(version.value.length === 0 ? {} : { version: version.value }),
      installHint: INSTALL_HINT,
      auth,
      ...(account === undefined ? {} : { account }),
    } satisfies DeploymentProviderDiscoveryItem;
  });

  const projectAt = (workspaceRoot: string, link: VercelProjectLink): DeploymentProject => {
    // A personal account's id is not a scope the CLI accepts; its default scope already fits.
    const scope = link.orgId.startsWith("team_") ? ["--scope", link.orgId] : [];
    const unreadable = new DeploymentError({ reason: "unreadable-output", provider: "vercel" });
    const failed = new DeploymentError({ reason: "failed", provider: "vercel" });

    return {
      name: link.projectName ?? link.projectId,
      list: Effect.fn("VercelDriver.list")(function* (input) {
        yield* requireSignIn;
        const output = yield* run({
          cwd: workspaceRoot,
          args: [
            "ls",
            link.projectId,
            "--json",
            "--limit",
            LIST_LIMIT,
            ...scope,
            // Only GitHub-connected projects carry this key; other hosts list unfiltered by it.
            ...(input.branch === undefined ? [] : ["--meta", `githubCommitRef=${input.branch}`]),
          ],
          timeoutMs: 20_000,
        });
        const list = parseDeploymentList(output.stdout);
        if (list !== null && output.exitCode === 0) return list.deployments;
        return yield* parseCliErrorReason(output.stdout) === undefined ? unreadable : failed;
      }),
      logs: Effect.fn("VercelDriver.logs")(function* (input) {
        yield* requireSignIn;
        if (input.source === "build") {
          const output = yield* run({
            cwd: workspaceRoot,
            args: ["inspect", input.hostname, "--logs", ...scope],
            timeoutMs: 30_000,
            maxOutputBytes: LOG_OUTPUT_BYTES,
          });
          if (output.exitCode !== 0) return yield* failed;
          return parseBuildLogs(output.stderr, output.truncated);
        }
        const output = yield* run({
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
          maxOutputBytes: LOG_OUTPUT_BYTES,
        });
        if (output.exitCode !== 0) return yield* failed;
        return parseRuntimeLogs(output.stdout, output.truncated);
      }),
    };
  };

  return {
    discover,
    projectFor: (workspaceRoot: string) =>
      fileSystem.readFileString(`${workspaceRoot}/.vercel/project.json`).pipe(
        Effect.map(parseProjectLink),
        Effect.map((link) => (link === null ? null : projectAt(workspaceRoot, link))),
        Effect.orElseSucceed(() => null),
      ),
  };
});

export const driver = defineDeploymentDriver({
  kind: "vercel",
  hints: {
    missingCli: INSTALL_HINT,
    unauthenticated: "Run `vercel login` on the server to read this project's deployments.",
  },
  make,
});
