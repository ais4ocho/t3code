import { createFileRoute } from "@tanstack/react-router";

import { DeploymentsPage } from "../components/deployment/DeploymentsPage";
import { deploymentsSearchFromUrl } from "../components/deployment/deploymentsSearch.logic";

export const Route = createFileRoute("/_chat/deployments")({
  validateSearch: deploymentsSearchFromUrl,
  component: DeploymentsPage,
});
