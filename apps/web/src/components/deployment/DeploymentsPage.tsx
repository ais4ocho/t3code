import { useAtomValue } from "@effect/atom-react";
import {
  DEPLOYMENT_IN_PROGRESS_REFRESH_MS,
  deploymentTargetsInProgress,
  listDeploymentsAcrossProjects,
  type ListedDeployment,
} from "@t3tools/client-runtime/state/deployments";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useEffectEvent, type ReactNode } from "react";

import { RefreshIcon } from "~/components/ui/refresh-icon";
import { DeploymentDetailPanel } from "~/components/deployment/DeploymentDetailPanel";
import { DeploymentRow } from "~/components/deployment/DeploymentRow";
import { DeploymentGlyph } from "~/components/deployment/deploymentPresentation";
import { PullRequestListGhost } from "~/components/pullRequest/PullRequestGhosts";
import { PullRequestsUnavailableState } from "~/components/pullRequest/PullRequestsUnavailableState";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { PanelLayoutControls } from "~/components/chat/PanelLayoutControls";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { SidebarInset } from "~/components/ui/sidebar";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { usePanelAnimationSettings, usePanelPresence } from "~/panelAnimations";
import {
  DEPLOYMENTS_PANEL_REF,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type DeploymentSurfaceTarget,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { useDeploymentLists, type DeploymentListTarget } from "~/state/deployments";
import { useProjects } from "~/state/entities";
import { useDeploymentsSupported, useEnvironments } from "~/state/environments";
import { primaryServerKeybindingsAtom } from "~/state/server";

export interface DeploymentsSearch {
  readonly selectedEnvironmentId?: EnvironmentId | undefined;
  readonly selectedProjectId?: ProjectId | undefined;
  /** The selected deployment's hostname. */
  readonly deployment?: string | undefined;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_RECORD = {} as const;
const EMPTY_MAP = new Map<string, string>();

function getShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

function selectionSearch(target: DeploymentSurfaceTarget): DeploymentsSearch {
  return {
    selectedEnvironmentId: target.environmentId as EnvironmentId | undefined,
    selectedProjectId: target.projectId as ProjectId,
    deployment: target.hostname,
  };
}

export function DeploymentsPage() {
  const navigate = useNavigate({ from: "/deployments" });
  const search = useSearch({ from: "/_chat/deployments" });
  const { environments } = useEnvironments();
  const projects = useProjects();
  const deploymentsSupported = useDeploymentsSupported();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const capableEnvironments = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.deployments === true,
  );
  const capableEnvironmentIds = new Set(capableEnvironments.map((e) => e.environmentId));

  // Sorted because the targets key the merged list: the same projects must read the same atom.
  const targets: ReadonlyArray<DeploymentListTarget> = projects
    .filter((project) => !project.isScratch && capableEnvironmentIds.has(project.environmentId))
    .map((project) => ({ environmentId: project.environmentId, input: { projectId: project.id } }))
    .toSorted(
      (a, b) =>
        a.environmentId.localeCompare(b.environmentId) ||
        a.input.projectId.localeCompare(b.input.projectId),
    );
  const list = useDeploymentLists(targets);
  const rows = listDeploymentsAcrossProjects(list.projects);
  // Every project now and then; the ones with a deployment in progress much more often.
  const refreshKey = JSON.stringify(targets);
  const inProgress = deploymentTargetsInProgress(list.projects);
  useLiveRefresh(() => list.refresh(), { key: refreshKey, intervalMs: 60_000 });
  useLiveRefresh(() => list.refresh(inProgress), {
    key: `${refreshKey}:in-progress`,
    intervalMs: DEPLOYMENT_IN_PROGRESS_REFRESH_MS,
    enabled: inProgress.length > 0,
  });
  // Every project of a signed-out provider carries the same hint, so it is said once.
  const unavailableByHint = new Map<string, Set<string>>();
  for (const { result } of list.projects) {
    if (result.status !== "unavailable") continue;
    const names = unavailableByHint.get(result.hint) ?? new Set();
    unavailableByHint.set(result.hint, names.add(result.projectName));
  }
  const readable = list.projects.some(({ result }) => result.status === "linked");

  // One shared panel for the page, with a fixed sentinel ref, as the issues page does.
  const rightPanelRef = capableEnvironments.length === 0 ? null : DEPLOYMENTS_PANEL_REF;
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, rightPanelRef),
  );
  const selectedSurface = useRightPanelStore((state) =>
    selectSelectedRightPanelSurface(state.byThreadKey, rightPanelRef),
  );
  const panelSurface = selectedSurface?.kind === "deployment" ? selectedSurface : null;
  const { active: panelAnimationsActive, durationMs } = usePanelAnimationSettings();
  const presenceValue = { activeSurface: panelSurface, surfaces: rightPanelState.surfaces };
  const presence = usePanelPresence(
    rightPanelState.isOpen && panelSurface !== null,
    presenceValue,
    panelAnimationsActive,
    rightPanelRef?.threadId ?? null,
    durationMs,
  );
  const renderedSurface = presence.value?.activeSurface ?? null;
  const panelEnvironmentId =
    (renderedSurface?.environmentId as EnvironmentId | undefined) ??
    capableEnvironments[0]?.environmentId ??
    null;

  const selectSurfaceInUrl = (surface: RightPanelSurface | null) =>
    void navigate({ search: surface?.kind === "deployment" ? selectionSearch(surface) : {} });

  const selectEntry = (entry: ListedDeployment) => {
    if (rightPanelRef === null) return;
    const target = {
      environmentId: entry.environmentId,
      projectId: entry.projectId,
      hostname: entry.deployment.hostname,
    };
    useRightPanelStore.getState().openDeployment(rightPanelRef, target);
    void navigate({ search: selectionSearch(target) });
  };

  // A link into the page names a deployment before any row was pressed.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the URL-linked deployment in the right panel store
  useEffect(() => {
    if (rightPanelRef === null || !search.deployment || !search.selectedProjectId) return;
    useRightPanelStore.getState().openDeployment(rightPanelRef, {
      ...(search.selectedEnvironmentId === undefined
        ? {}
        : { environmentId: search.selectedEnvironmentId }),
      projectId: search.selectedProjectId,
      hostname: search.deployment,
    });
  }, [rightPanelRef, search.deployment, search.selectedProjectId, search.selectedEnvironmentId]);

  const closeSurface = (surface: RightPanelSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeSurface(rightPanelRef, surface.id);
    selectSurfaceInUrl(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, rightPanelRef),
    );
  };
  const toggleRightPanel = () => {
    if (rightPanelRef === null) return;
    if (rightPanelState.isOpen) {
      useRightPanelStore.getState().close(rightPanelRef);
      selectSurfaceInUrl(null);
      return;
    }
    if (panelSurface === null) return;
    useRightPanelStore.getState().show(rightPanelRef);
    selectSurfaceInUrl(panelSurface);
  };

  const onRightPanelKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isCommandPaletteOpen() || panelSurface === null) return;
    const command = resolveShortcutCommand(event, keybindings, {
      context: { ...getShortcutContext(), rightPanelOpen: rightPanelState.isOpen },
    });
    if (command !== "rightPanel.toggle") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) toggleRightPanel();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the document right panel shortcut
  useEffect(() => {
    document.addEventListener("keydown", onRightPanelKeyDown);
    return () => document.removeEventListener("keydown", onRightPanelKeyDown);
  }, []);

  const nothingListed = list.projects.length === 0;

  const listBody: ReactNode = !deploymentsSupported ? (
    <PullRequestsUnavailableState
      title="Deployments unavailable"
      error="Update this environment's T3 Code server to browse deployments."
    />
  ) : nothingListed && list.isLoading ? (
    <PullRequestListGhost />
  ) : nothingListed && list.error ? (
    <PullRequestsUnavailableState
      title="Could not load deployments"
      error={list.error}
      onRetry={() => list.refresh()}
      refreshing={list.isPending}
    />
  ) : nothingListed ? (
    <Empty>
      <EmptyMedia variant="icon">
        <DeploymentGlyph.deployment />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>No linked projects</EmptyTitle>
        <EmptyDescription>
          A project shows its deployments here once its folder is linked with{" "}
          <code className="font-mono">vercel link</code>.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : (
    <div className="flex flex-col gap-4">
      {list.error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs">
          <span>{list.error} Showing the deployments that loaded.</span>
          <Button size="xs" variant="outline" onClick={() => list.refresh()}>
            Retry
          </Button>
        </div>
      ) : null}
      {[...unavailableByHint].map(([hint, names]) => (
        <p
          key={hint}
          className="rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs"
        >
          {[...names].join(", ")}: {hint}
        </p>
      ))}
      {rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <DeploymentRow
              key={row.deployment.hostname}
              entry={row}
              selected={renderedSurface?.hostname === row.deployment.hostname}
              onSelect={selectEntry}
            />
          ))}
        </div>
      ) : readable ? (
        <Empty>
          <EmptyMedia variant="icon">
            <DeploymentGlyph.deployment />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No deployments yet</EmptyTitle>
            <EmptyDescription>Deploy a linked project to see it here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader
            electron={isElectron}
            reserveNativeControls={!rightPanelState.isOpen}
            className="relative bg-background"
          >
            <WorkspaceBreadcrumb ariaLabel="Deployments breadcrumb">
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">Deployments</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <div className="min-w-0 flex-1" />
            <div
              className="flex items-center gap-1 [-webkit-app-region:no-drag]"
              data-workspace-titlebar-controls
            >
              <PanelLayoutControls
                showTerminalControl={false}
                showThreadPanelControl={false}
                terminalAvailable={false}
                terminalOpen={false}
                terminalShortcutLabel={null}
                threadPanelOpen={false}
                threadPanelPresentation="inline"
                threadPanelShortcutLabel={null}
                onToggleThreadPanel={() => undefined}
                rightPanelAvailable={panelSurface !== null}
                rightPanelOpen={rightPanelState.isOpen}
                rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
                rightPanelUnavailableLabel="Select a deployment first"
                onToggleTerminal={() => undefined}
                onToggleRightPanel={toggleRightPanel}
              />
            </div>
          </WorkspacePageHeader>

          <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
            <WorkspacePageContainer width="expanded" className="min-h-full gap-4">
              <div className="flex items-center justify-end">
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Refresh deployments"
                  onClick={() => list.refresh()}
                  disabled={list.isPending}
                >
                  <RefreshIcon size="md" refreshing={list.isPending} />
                </Button>
              </div>
              {listBody}
            </WorkspacePageContainer>
          </div>
        </div>

        {presence.present &&
        renderedSurface &&
        panelEnvironmentId !== null &&
        rightPanelRef !== null ? (
          <RightPanelTabs
            mode="inline"
            open={rightPanelState.isOpen}
            keybindings={keybindings}
            getShortcutContext={getShortcutContext}
            widthStorageKey="t3code:deployment-panel-width"
            defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
            surfaces={presence.value?.surfaces ?? []}
            environmentId={panelEnvironmentId}
            activeSurfaceId={renderedSurface.id}
            pendingSurfaceIds={EMPTY_SET}
            previewSessions={EMPTY_RECORD}
            desktopByTabId={EMPTY_RECORD}
            terminalLabelsById={EMPTY_MAP}
            onActivate={(surface) => {
              useRightPanelStore.getState().activateSurface(rightPanelRef, surface.id);
              selectSurfaceInUrl(surface);
            }}
            onCloseSurface={closeSurface}
            onCloseOtherSurfaces={(surface) => {
              useRightPanelStore.getState().closeOtherSurfaces(rightPanelRef, surface.id);
              selectSurfaceInUrl(surface);
            }}
            onCloseSurfacesToRight={(surface) => {
              useRightPanelStore.getState().closeSurfacesToRight(rightPanelRef, surface.id);
              selectSurfaceInUrl(
                selectActiveRightPanelSurface(
                  useRightPanelStore.getState().byThreadKey,
                  rightPanelRef,
                ),
              );
            }}
            onCloseAllSurfaces={() => {
              useRightPanelStore.getState().closeAllSurfaces(rightPanelRef);
              selectSurfaceInUrl(null);
            }}
            onMoveSurface={(surfaceId, toIndex) =>
              useRightPanelStore.getState().moveSurface(rightPanelRef, surfaceId, toIndex)
            }
            onCopyFilePath={() => undefined}
            onAddBrowser={() => undefined}
            onAddBrowserInProfile={() => undefined}
            onAddTerminal={() => undefined}
            onAddDiff={() => undefined}
            onAddFiles={() => undefined}
            onAddPullRequest={() => undefined}
            onAddPullRequests={() => undefined}
            onAddDevice={() => undefined}
            browserAvailable={false}
            terminalAvailable={false}
            diffAvailable={false}
            filesAvailable={false}
            pullRequestAvailable={false}
            pullRequestsAvailable={false}
            deviceAvailable={false}
          >
            <DeploymentDetailPanel
              key={renderedSurface.id}
              environmentId={panelEnvironmentId}
              projectId={renderedSurface.projectId as ProjectId}
              hostname={renderedSurface.hostname}
              branch={renderedSurface.branch}
            />
          </RightPanelTabs>
        ) : null}
      </div>
    </SidebarInset>
  );
}
