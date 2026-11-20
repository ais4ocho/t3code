import { deploymentStatePresentation } from "@t3tools/client-runtime/deployment-presentation";
import type { DeploymentState } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import { CircleSlashIcon, RocketIcon } from "lucide-react";

import { m, type MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";

import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";
import { pullRequestChecksStatePresentation } from "../pullRequest/pullRequestPresentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const DeploymentGlyph = { deployment: RocketIcon } as const;

/**
 * A build is a check that runs somewhere else, so its states borrow the marks and ink of a pull
 * request's checks. A canceled one wears a draft's grey, because work that stopped must not look
 * like work that failed.
 */
export function deploymentStateMark(state: DeploymentState, resolve: MessageResolver = m) {
  const { label, tone } = deploymentStatePresentation(state, resolve);
  switch (tone) {
    case "pending":
      return { ...pullRequestChecksStatePresentation("pending"), label };
    case "success":
      return { ...pullRequestChecksStatePresentation("passing"), label };
    case "failure":
      return { ...pullRequestChecksStatePresentation("failing"), label };
    case "neutral":
      return {
        label,
        Icon: CircleSlashIcon,
        toneClassName: PULL_REQUEST_STATE_PRESENTATION.draft.toneClassName,
      };
  }
}

export function DeploymentStateGlyph({ state }: { state: DeploymentState }) {
  const messages = useMessages();
  const mark = deploymentStateMark(state, messages);
  return (
    <Tooltip>
      {/* The list row is itself a button, so the trigger stays a span. */}
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <mark.Icon
          role="img"
          aria-label={mark.label}
          className={cn("size-4 shrink-0", mark.toneClassName)}
        />
      </TooltipTrigger>
      <TooltipPopup>{mark.label}</TooltipPopup>
    </Tooltip>
  );
}
