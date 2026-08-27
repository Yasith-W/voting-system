import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  IS_DEPLOYED,
  EXPECTED_CHAIN_ID,
} from "../contracts/config.js";

/**
 * Connects to MetaMask and hands back an ethers Contract bound to the signer,
 * along with the current account, chain, and a switch-network helper.
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

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum || EXPECTED_CHAIN_ID == null) return;
    const hexChainId = "0x" + Number(EXPECTED_CHAIN_ID).toString(16);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
    } catch (err) {
      // 4902 = chain not added to the wallet yet.
      setError(
        err?.code === 4902
          ? "That network isn't in your wallet yet — add it manually, then retry."
          : err?.message || "Could not switch network."
      );
    }
  }, []);

  const onExpectedNetwork =
    EXPECTED_CHAIN_ID == null || chainId == null || chainId === EXPECTED_CHAIN_ID;

  useEffect(() => {
    if (!hasMetaMask) return;

    const handleAccountsChanged = (accounts) => {
      setAccount(accounts[0] ?? null);
      if (!accounts[0]) {
        setContract(null);
      }
    };
    const handleChainChanged = () => {
      // reload so the provider, signer and network stay in sync
      window.location.reload();
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [hasMetaMask]);

  return {
    provider,
    account,
    contract,
    chainId,
    error,
    connecting,
    hasMetaMask,
    connect,
    switchNetwork,
    onExpectedNetwork,
  };
}
