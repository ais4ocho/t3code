import type { DeploymentProviderDiscoveryItem, EnvironmentId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { deploymentEnvironment } from "../../state/deployments";
import { useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { VercelIcon, type Icon } from "../Icons";

import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Web art per provider kind; the server supplies everything else about a provider. */
const PROVIDER_ICONS: Partial<Record<string, Icon>> = {
  vercel: VercelIcon,
};

/**
 * The deployment providers one environment's server can read, and whether each CLI is ready.
 * Read-only: installing a CLI and signing in to it happen on the server, outside T3 Code.
 */
export function DeploymentProviderSettings({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.deployments === true;
  const query = useEnvironmentQuery(
    supported ? deploymentEnvironment.providers({ environmentId, input: {} }) : null,
  );
  const providers = query.data?.providers ?? [];
  if (query.data === null && query.isPending) {
    return (
      <SettingsSection {...searchableSetting("deployment-providers")}>
        <div className="grid gap-3 px-4 py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (query.data === null && query.error !== null) {
    return (
      <SettingsSection {...searchableSetting("deployment-providers")}>
        <SettingsRow
          title="Could not load deployment providers"
          description={query.error}
          control={
            <Button size="xs" variant="outline" onClick={query.refresh}>
              Retry
            </Button>
          }
        />
      </SettingsSection>
    );
  }
  if (providers.length === 0) return null;
  return (
    <SettingsSection {...searchableSetting("deployment-providers")}>
      <p className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4">
        T3 Code reads a linked project's deployments and logs through the provider's CLI on the
        server.
      </p>
      {providers.map((provider) => (
        <SettingsRow
          key={provider.kind}
          title={<ProviderTitle provider={provider} />}
          description={providerSummary(provider)}
        />
      ))}
    </SettingsSection>
  );
}

function ProviderTitle({ provider }: { readonly provider: DeploymentProviderDiscoveryItem }) {
  const Icon = PROVIDER_ICONS[provider.kind];
  return (
    <span className="flex min-w-0 items-center gap-2">
      {Icon ? <Icon className="size-4.5 shrink-0 text-foreground/80" aria-hidden /> : null}
      <span className="min-w-0 truncate">{provider.label}</span>
      {provider.version ? (
        <code className="shrink-0 text-xs font-normal text-muted-foreground">
          {provider.version}
        </code>
      ) : null}
    </span>
  );
}

function providerSummary(provider: DeploymentProviderDiscoveryItem): ReactNode {
  if (provider.status === "missing") return provider.installHint;
  if (provider.auth === "authenticated") {
    return provider.account ? `Signed in as ${provider.account}` : "Signed in";
  }
  if (provider.auth === "unauthenticated") {
    return (
      <>
        The {provider.label} CLI is signed out. Run{" "}
        <code className="rounded bg-muted px-1 py-px text-2xs">{provider.executable} login</code> on
        the server.
      </>
    );
  }
  return `Could not check whether the ${provider.label} CLI is signed in.`;
}
