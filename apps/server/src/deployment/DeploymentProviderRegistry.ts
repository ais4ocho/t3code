import type { DeploymentProviderApi } from "@t3tools/deployment-core/server/DeploymentProvider";
import * as VercelDriver from "@t3tools/deployment-vercel/server/driver";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DeploymentHostLive from "./DeploymentHostLive.ts";

export class DeploymentProviderRegistry extends Context.Service<
  DeploymentProviderRegistry,
  {
    /** In the order a checkout is offered to them; the first to claim it is its provider. */
    readonly providers: ReadonlyArray<DeploymentProviderApi>;
  }
>()("t3/deployment/DeploymentProviderRegistry") {}

/** Exported for tests, which stand a registry up from providers they supply themselves. */
export function fromProviders(
  providers: ReadonlyArray<DeploymentProviderApi>,
): DeploymentProviderRegistry["Service"] {
  return { providers };
}

const PROVIDERS = [VercelDriver.make];

const make = Effect.all(PROVIDERS).pipe(Effect.map(fromProviders));

export const layer = Layer.effect(DeploymentProviderRegistry, make).pipe(
  Layer.provide(DeploymentHostLive.layer),
);
