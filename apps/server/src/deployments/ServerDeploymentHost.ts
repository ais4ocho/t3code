import { DeploymentError } from "@t3tools/contracts";
import { DeploymentHost } from "@t3tools/deployment-core/server/driver";
import { isCommandMissingCause } from "@t3tools/provider-core/server/snapshotProbe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

const isSpawnError = Schema.is(ProcessRunner.ProcessSpawnError);
const isTimeoutError = Schema.is(ProcessRunner.ProcessTimeoutError);

export const layer = Layer.effect(
  DeploymentHost,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const processRunner = yield* ProcessRunner.ProcessRunner;

    return DeploymentHost.of({
      process: {
        run: (input) =>
          processRunner
            .run({
              command: input.command,
              args: input.args,
              cwd: input.cwd ?? config.cwd,
              timeout: Duration.millis(input.timeoutMs),
              maxOutputBytes: input.maxOutputBytes,
              outputMode: "truncate",
            })
            .pipe(
              Effect.map((output) => ({
                exitCode: output.code === null ? 1 : Number(output.code),
                stdout: output.stdout,
                stderr: output.stderr,
                truncated: output.stdoutTruncated || output.stderrTruncated,
              })),
              Effect.mapError(
                (cause) =>
                  new DeploymentError({
                    reason: isTimeoutError(cause)
                      ? "timeout"
                      : isSpawnError(cause) && isCommandMissingCause(cause.cause)
                        ? "missing-cli"
                        : "failed",
                    cause,
                  }),
              ),
            ),
      },
    });
  }),
);
