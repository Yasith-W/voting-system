// VotingSystem.json is rewritten by scripts/deploy.js on every deploy.
import deployment from "./VotingSystem.json";

export const CONTRACT_ADDRESS = deployment.address;
export const CONTRACT_ABI = deployment.abi;
export const DEPLOYMENT_NETWORK = deployment.network;
export const IS_DEPLOYED = deployment.network !== "not-deployed-yet";

// Chain the contract is on (11155111 = Sepolia, 31337 = local Hardhat).
// null if not deployed yet, in which case we skip the network check.
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
