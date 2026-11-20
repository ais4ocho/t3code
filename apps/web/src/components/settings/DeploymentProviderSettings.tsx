import type { DeploymentProviderDiscoveryItem, EnvironmentId } from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import type { ReactNode } from "react";

import { deploymentEnvironment } from "../../state/deployments";
import { useServerConfigs } from "../../state/entities";
import { m, type MessageResolver } from "../../i18n/messages";
import { useEnvironmentQuery } from "../../state/query";
import { VercelIcon, type Icon } from "../Icons";

import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

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
  const gt = useGT();
  const messages = useMessages();
  const searchableSetting = useSearchableSetting();
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
          title={gt("Could not load deployment providers")}
          description={query.error}
          control={
            <Button size="xs" variant="outline" onClick={query.refresh}>
              <T>Retry</T>
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
        <T>
          T3 Code reads a linked project's deployments and logs through the provider's CLI on the
          server.
        </T>
      </p>
      {providers.map((provider) => (
        <SettingsRow
          key={provider.kind}
          title={<ProviderTitle provider={provider} />}
          description={providerSummary(provider, messages)}
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

function providerSummary(
  provider: DeploymentProviderDiscoveryItem,
  resolve: MessageResolver = m,
): ReactNode {
  if (provider.status === "missing") return provider.installHint;
  if (provider.auth === "authenticated") {
    return provider.account
      ? resolve(msg("Signed in as {account}", { account: provider.account }))
      : resolve(msg("Signed in"));
  }
  if (provider.auth === "unauthenticated") {
    return (
      <T>
        The <Var>{provider.label}</Var> CLI is signed out. Run{" "}
        <code className="rounded bg-muted px-1 py-px text-2xs">
          <Var>{provider.executable}</Var> login
        </code>{" "}
        on the server.
      </T>
    );
  }
  return resolve(
    msg("Could not check whether the {provider} CLI is signed in.", { provider: provider.label }),
  );
}
