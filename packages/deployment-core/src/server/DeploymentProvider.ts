import {
  type Deployment,
  type DeploymentHostname,
  type DeploymentLogPage,
  type DeploymentLogSource,
  type DeploymentProviderDiscoveryItem,
  DeploymentProviderKind,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The one failure shape every provider reports, so the service can decide what a failure means
 * without knowing which CLI produced it. A missing or signed-out tool disables the provider for
 * the whole server; everything else is specific to the request.
 */
export class DeploymentProviderError extends Schema.TaggedError<DeploymentProviderError>()(
  "DeploymentProviderError",
  {
    provider: DeploymentProviderKind,
    operation: Schema.String,
    reason: Schema.Literals(["missing-tool", "unauthenticated", "failed"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}

/** One checkout's project on a provider. */
export interface DeploymentProject {
  readonly name: string;
  /** Newest first. */
  readonly list: (input: {
    readonly branch?: string | undefined;
  }) => Effect.Effect<ReadonlyArray<Deployment>, DeploymentProviderError>;
  readonly logs: (input: {
    readonly hostname: DeploymentHostname;
    readonly source: DeploymentLogSource;
    readonly cursor?: string | undefined;
  }) => Effect.Effect<DeploymentLogPage, DeploymentProviderError>;
}

export interface DeploymentProviderApi {
  readonly kind: DeploymentProviderKind;
  /** What to tell a user whose linked project the server cannot read. */
  readonly hints: { readonly toolMissing: string; readonly unauthenticated: string };
  /** Never signs in, links or installs: it only reports what is already on the server. */
  readonly discover: Effect.Effect<DeploymentProviderDiscoveryItem>;
  /** Null when `workspaceRoot` is not linked to this provider. Reads the checkout only. */
  readonly projectFor: (workspaceRoot: string) => Effect.Effect<DeploymentProject | null>;
}
