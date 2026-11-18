import * as VercelDeployments from "./VercelDeployments.ts";

/**
 * Vercel deployments over the `vercel` CLI already installed and signed in on the server. Needs
 * the server's `DeploymentHost` to run it and the platform FileSystem to read a checkout's link.
 */
export const make = VercelDeployments.make;
