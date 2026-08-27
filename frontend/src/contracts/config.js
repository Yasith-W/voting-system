import deployment from "./VotingSystem.json";

// deployment.address / deployment.abi are (re)written by `npm run deploy:local`
// or `npm run deploy:sepolia` at the project root — see scripts/deploy.js.
export const CONTRACT_ADDRESS = deployment.address;
export const CONTRACT_ABI = deployment.abi;
export const DEPLOYMENT_NETWORK = deployment.network;
export const IS_DEPLOYED = deployment.network !== "not-deployed-yet";

// The chain the contract is deployed on (e.g. 11155111 for Sepolia, 31337 for a
// local Hardhat node). null when the deployment info predates this field or the
// contract isn't deployed yet, in which case the frontend skips the network check.
export const EXPECTED_CHAIN_ID =
  deployment.chainId == null ? null : String(deployment.chainId);

const CHAIN_NAMES = {
  "1": "Ethereum Mainnet",
  "11155111": "Sepolia",
  "31337": "the local Hardhat node",
};

export function chainName(chainId) {
  return CHAIN_NAMES[String(chainId)] || `chain ${chainId}`;
}
