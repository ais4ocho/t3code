import type {
  Deployment,
  DeploymentError,
  DeploymentHostname,
  DeploymentLogPage,
  DeploymentLogSource,
  DeploymentProviderDiscoveryItem,
  DeploymentProviderKind,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

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

/** What the server lends a driver. A driver reaches its provider only through this. */
export class DeploymentHost extends Context.Service<
  DeploymentHost,
  {
    readonly process: {
      /** Fails as `missing-cli`, `timeout` or `failed`; a non-zero exit is an output, not a failure. */
      readonly run: (
        input: DeploymentProcessInput,
      ) => Effect.Effect<DeploymentProcessOutput, DeploymentError>;
    };
  }
>()("@t3tools/deployment-core/server/driver/DeploymentHost") {}

/** One checkout's project on a provider. */
export interface DeploymentProject {
  readonly name: string;
  readonly list: (input: {
    readonly branch?: string | undefined;
  }) => Effect.Effect<ReadonlyArray<Deployment>, DeploymentError>;
  readonly logs: (input: {
    readonly hostname: DeploymentHostname;
    readonly source: DeploymentLogSource;
    readonly cursor?: string | undefined;
  }) => Effect.Effect<DeploymentLogPage, DeploymentError>;
}

export interface DeploymentDriverInstance {
  /** Never signs in, links or installs: it only reports what is already on the server. */
  readonly discover: Effect.Effect<DeploymentProviderDiscoveryItem>;
  /** Null when `workspaceRoot` is not linked to this provider. Reads the checkout only. */
  readonly projectFor: (workspaceRoot: string) => Effect.Effect<DeploymentProject | null>;
}

export type DeploymentDriverServices = DeploymentHost | FileSystem.FileSystem;

export interface DeploymentDriver {
  readonly kind: DeploymentProviderKind;
  /** What to tell a user whose linked project the server cannot read. */
  readonly hints: { readonly missingCli: string; readonly unauthenticated: string };
  readonly make: Effect.Effect<DeploymentDriverInstance, never, DeploymentDriverServices>;
}

export const defineDeploymentDriver = (driver: DeploymentDriver): DeploymentDriver => driver;
