import deployment from "./VotingSystem.json";

// deployment.address / deployment.abi are (re)written by `npm run deploy:local`
// or `npm run deploy:sepolia` at the project root — see scripts/deploy.js.
export const CONTRACT_ADDRESS = deployment.address;
export const CONTRACT_ABI = deployment.abi;
export const DEPLOYMENT_NETWORK = deployment.network;
export const IS_DEPLOYED = deployment.network !== "not-deployed-yet";
