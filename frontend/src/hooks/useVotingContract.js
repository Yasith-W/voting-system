import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { CONTRACT_ADDRESS, CONTRACT_ABI, IS_DEPLOYED } from "../contracts/config.js";

/**
 * Wallet + contract connection hook.
 * Handles MetaMask detection, connecting, and exposes a read/write
 * ethers Contract instance bound to the connected signer.
 */
export function useVotingContract() {
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState(null);
  const [contract, setContract] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const hasMetaMask = typeof window !== "undefined" && Boolean(window.ethereum);

  const connect = useCallback(async () => {
    setError(null);

    if (!hasMetaMask) {
      setError("MetaMask was not detected. Please install it to use this DApp.");
      return;
    }
    if (!IS_DEPLOYED) {
      setError(
        "No contract address found yet. Run `npm run deploy:local` or `npm run deploy:sepolia` from the project root, then reload."
      );
      return;
    }

    try {
      setConnecting(true);
      const browserProvider = new BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      const signer = await browserProvider.getSigner();
      const network = await browserProvider.getNetwork();

      const votingContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

      setProvider(browserProvider);
      setAccount(accounts[0]);
      setChainId(network.chainId.toString());
      setContract(votingContract);
    } catch (err) {
      console.error(err);
      setError(err?.info?.error?.message || err?.message || "Failed to connect wallet.");
    } finally {
      setConnecting(false);
    }
  }, [hasMetaMask]);

  useEffect(() => {
    if (!hasMetaMask) return;

    const handleAccountsChanged = (accounts) => {
      setAccount(accounts[0] ?? null);
      if (!accounts[0]) {
        setContract(null);
      }
    };
    const handleChainChanged = () => {
      // Simplest, safest way to keep provider/signer/network in sync.
      window.location.reload();
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [hasMetaMask]);

  return { provider, account, contract, chainId, error, connecting, hasMetaMask, connect };
}
