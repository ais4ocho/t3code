import {
  DeploymentHost,
  DeploymentProcessError,
} from "@t3tools/deployment-core/server/DeploymentHost";
import { isCommandMissingCause } from "@t3tools/provider-core/server/snapshotProbe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

const isSpawnError = Schema.is(ProcessRunner.ProcessSpawnError);
const isTimeoutError = Schema.is(ProcessRunner.ProcessTimeoutError);

// A provider's CLI is a whole runtime per call, and a page of projects asks for many at once.
const CONCURRENT_PROCESSES = 2;

export const layer = Layer.effect(
  DeploymentHost,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const running = yield* Semaphore.make(CONCURRENT_PROCESSES);

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
              running.withPermits(1),
              Effect.map((output) => ({
                exitCode: output.code === null ? 1 : Number(output.code),
                stdout: output.stdout,
                stderr: output.stderr,
                truncated: output.stdoutTruncated || output.stderrTruncated,
              })),
              Effect.mapError(
                (cause) =>
                  new DeploymentProcessError({
                    reason: isTimeoutError(cause)
                      ? "timed-out"
                      : isSpawnError(cause) && isCommandMissingCause(cause.cause)
                        ? "missing-tool"
                        : "failed",
                    cause,
                  }),
              ),
            ),
      },
    });
  }),
);
