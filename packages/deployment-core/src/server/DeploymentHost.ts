import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface DeploymentProcessInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Defaults to the server's own directory. */
  readonly cwd?: string | undefined;
  readonly timeoutMs: number;
  /** Output beyond this is cut off the end and reported as `truncated`. */
  readonly maxOutputBytes: number;
}

export interface DeploymentProcessOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

/** The command never produced an exit code. */
export class DeploymentProcessError extends Schema.TaggedError<DeploymentProcessError>()(
  "DeploymentProcessError",
  {
    reason: Schema.Literals(["missing-tool", "timed-out", "failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** What the server lends a provider. A provider reaches its service only through this. */
export class DeploymentHost extends Context.Service<
  DeploymentHost,
  {
    readonly process: {
      /** A non-zero exit is an output, not a failure. */
      readonly run: (
        input: DeploymentProcessInput,
      ) => Effect.Effect<DeploymentProcessOutput, DeploymentProcessError>;
    };
  }
>()("@t3tools/deployment-core/server/DeploymentHost") {}
