import { useCallback, useEffect, useState } from "react";
import { useVotingContract } from "./hooks/useVotingContract.js";
import { IS_DEPLOYED, DEPLOYMENT_NETWORK } from "./contracts/config.js";
import CreateElectionForm from "./components/CreateElectionForm.jsx";
import ElectionCard from "./components/ElectionCard.jsx";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  const { account, contract, chainId, error, connecting, hasMetaMask, connect } =
    useVotingContract();

  const [electionIds, setElectionIds] = useState([]);
  const [isOrganiser, setIsOrganiser] = useState(false);
  const [totalVotesAcrossAll, setTotalVotesAcrossAll] = useState(0);

  const refreshElections = useCallback(async () => {
    if (!contract) return;
    const count = Number(await contract.electionCount());
    setElectionIds(Array.from({ length: count }, (_, i) => i));

    let sum = 0;
    for (let i = 0; i < count; i++) {
      const [, , , , , totalVotesCast] = await contract.getElection(i);
      sum += Number(totalVotesCast);
    }
    setTotalVotesAcrossAll(sum);
  }, [contract]);

  useEffect(() => {
    refreshElections();
  }, [refreshElections]);

  useEffect(() => {
    async function checkOrganiser() {
      if (!contract || !account) return setIsOrganiser(false);
      const authorised = await contract.authorisedOrganisers(account);
      setIsOrganiser(authorised);
    }
    checkOrganiser();
  }, [contract, account]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Decentralized Voting System</h1>
          <p className="muted">
            DAS5003 Blockchain Fundamentals · Section 3 (PRAC1) — Option B
          </p>
        </div>
        <div className="wallet-bar">
          {!IS_DEPLOYED && (
            <span className="notice">
              Contract not deployed yet — run a deploy script first.
            </span>
          )}
          {account ? (
            <span className="account-pill">
              {account.slice(0, 6)}…{account.slice(-4)}
              {chainId && <span className="muted small"> · chain {chainId}</span>}
            </span>
          ) : (
            <button onClick={connect} disabled={connecting || !hasMetaMask}>
              {connecting
                ? "Connecting…"
                : hasMetaMask
                ? "Connect MetaMask"
                : "MetaMask not found"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}

      {contract && (
        <>
          <Dashboard electionCount={electionIds.length} totalVotesAcrossAll={totalVotesAcrossAll} />

          {isOrganiser && (
            <CreateElectionForm contract={contract} onCreated={refreshElections} />
          )}

          <section className="elections-grid">
            {electionIds.length === 0 && (
              <p className="muted">No elections created yet.</p>
            )}
            {electionIds
              .slice()
              .reverse()
              .map((id) => (
                <ElectionCard key={id} contract={contract} account={account} electionId={id} />
              ))}
          </section>
        </>
      )}

      {!contract && !error && (
        <p className="muted">
          Connect your wallet to view elections{DEPLOYMENT_NETWORK !== "not-deployed-yet" &&
            ` on ${DEPLOYMENT_NETWORK}`}.
        </p>
      )}
    </div>
  );
}
