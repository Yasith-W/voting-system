import { useCallback, useEffect, useState } from "react";

function formatTime(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
}

function timeStatus(startTs, endTs) {
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(startTs)) return "upcoming";
  if (now > Number(endTs)) return "closed";
  return "open";
}

export default function ElectionCard({ contract, account, electionId }) {
  const [details, setDetails] = useState(null);
  const [results, setResults] = useState(null);
  const [winner, setWinner] = useState(null);
  const [isEligible, setIsEligible] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [myChoice, setMyChoice] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [voterToRegister, setVoterToRegister] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async () => {
    try {
      const [title, options, startTime, endTime, organiser, totalVotesCast] =
        await contract.getElection(electionId);
      const [, counts] = await contract.getResults(electionId);
      const [winIndex, winLabel, winVotes, tie] =
        await contract.getWinningOption(electionId);

      setDetails({ title, options, startTime, endTime, organiser, totalVotesCast });
      setResults(counts.map((c) => Number(c)));
      setWinner({
        index: Number(winIndex),
        label: winLabel,
        votes: Number(winVotes),
        tie,
      });

      if (account) {
        const eligible = await contract.isEligible(electionId, account);
        const voted = await contract.hasAddressVoted(electionId, account);
        setIsEligible(eligible);
        setHasVoted(voted);
        if (voted) {
          const choice = await contract.getVoterChoice(electionId, account);
          setMyChoice(Number(choice));
        } else {
          setMyChoice(null);
        }
      }
    } catch (err) {
      console.error(err);
      setError(err?.reason || err?.shortMessage || err?.message || "Failed to load election.");
    }
  }, [contract, electionId, account]);

  useEffect(() => {
    load();
  }, [load]);

  const loadAuditLog = useCallback(async () => {
    try {
      const filterCast = contract.filters.VoteCast(electionId);
      const filterChanged = contract.filters.VoteChanged(electionId);
      const filterRegistered = contract.filters.VoterRegistered(electionId);

      const [castEvents, changedEvents, registeredEvents] = await Promise.all([
        contract.queryFilter(filterCast),
        contract.queryFilter(filterChanged),
        contract.queryFilter(filterRegistered),
      ]);

      const entries = [
        ...castEvents.map((e) => ({
          type: "Vote cast",
          voter: e.args.voter,
          detail: `chose "${details?.options?.[Number(e.args.optionIndex)] ?? e.args.optionIndex}"`,
          txHash: e.transactionHash,
        })),
        ...changedEvents.map((e) => ({
          type: "Vote changed",
          voter: e.args.voter,
          detail: `${details?.options?.[Number(e.args.previousOptionIndex)] ?? e.args.previousOptionIndex} → ${
            details?.options?.[Number(e.args.newOptionIndex)] ?? e.args.newOptionIndex
          }`,
          txHash: e.transactionHash,
        })),
        ...registeredEvents.map((e) => ({
          type: "Voter registered",
          voter: e.args.voter,
          detail: "",
          txHash: e.transactionHash,
        })),
      ];

      setAuditLog(entries);
    } catch (err) {
      console.error(err);
    }
  }, [contract, electionId, details]);

  const status = details ? timeStatus(details.startTime, details.endTime) : null;
  const totalVotes = results ? results.reduce((a, b) => a + b, 0) : 0;

  const handleRegister = async (event) => {
    event.preventDefault();
    if (!voterToRegister.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const tx = await contract.registerVoter(electionId, voterToRegister.trim());
      await tx.wait();
      setVoterToRegister("");
      await load();
    } catch (err) {
      console.error(err);
      setError(err?.reason || err?.shortMessage || err?.message || "Failed to register voter.");
    } finally {
      setBusy(false);
    }
  };

  const handleVote = async (optionIndex) => {
    setError(null);
    setBusy(true);
    try {
      const tx = hasVoted
        ? await contract.changeVote(electionId, optionIndex)
        : await contract.castVote(electionId, optionIndex);
      await tx.wait();
      await load();
    } catch (err) {
      console.error(err);
      setError(err?.reason || err?.shortMessage || err?.message || "Vote failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!details || !results) {
    return <div className="card election-card">Loading election #{electionId}…</div>;
  }

  const isOrganiser = account && details.organiser.toLowerCase() === account.toLowerCase();

  return (
    <div className="card election-card">
      <div className="election-header">
        <h3>{details.title}</h3>
        <span className={`status-pill status-${status}`}>{status}</span>
      </div>
      <p className="muted small">
        Organiser {details.organiser.slice(0, 6)}…{details.organiser.slice(-4)} · opens{" "}
        {formatTime(details.startTime)} · closes {formatTime(details.endTime)}
      </p>

      <div className="results">
        {details.options.map((opt, i) => {
          const count = results[i] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isMine = myChoice === i;
          return (
            <div className="result-row" key={i}>
              <div className="result-label">
                <span>
                  {opt} {isMine && <strong className="mine">· your vote</strong>}
                </span>
                <span>
                  {count} vote{count === 1 ? "" : "s"} ({pct}%)
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
              {account && status === "open" && isEligible && (
                <button
                  className="vote-btn"
                  disabled={busy || isMine}
                  onClick={() => handleVote(i)}
                >
                  {hasVoted ? (isMine ? "Selected" : "Change vote to this") : "Vote"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted small">Total votes cast: {totalVotes}</p>

      {account && !isEligible && (
        <p className="notice">You are not registered to vote in this election.</p>
      )}
      {status === "closed" && winner && (
        <p className="notice winner-notice">
          {winner.votes === 0
            ? "Voting has closed — no votes were cast."
            : winner.tie
            ? `Voting has closed — tied at ${winner.votes} vote${
                winner.votes === 1 ? "" : "s"
              }.`
            : `Winner: ${winner.label} — ${winner.votes} vote${
                winner.votes === 1 ? "" : "s"
              }.`}
        </p>
      )}
      {status === "open" && winner && winner.votes > 0 && (
        <p className="muted small">
          {winner.tie
            ? `Currently tied at ${winner.votes} vote${winner.votes === 1 ? "" : "s"}`
            : `Currently leading: ${winner.label}`}
        </p>
      )}

      {isOrganiser && (
        <form className="register-voter" onSubmit={handleRegister}>
          <input
            aria-label="Voter wallet address"
            placeholder="0x… voter address to register"
            value={voterToRegister}
            onChange={(e) => setVoterToRegister(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            Register voter
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="ghost small"
        onClick={() => {
          setShowAudit((v) => !v);
          if (!showAudit) loadAuditLog();
        }}
      >
        {showAudit ? "Hide" : "Show"} on-chain audit log
      </button>

      {showAudit && (
        <ul className="audit-log">
          {auditLog.length === 0 && <li className="muted small">No activity recorded yet.</li>}
          {auditLog.map((entry, i) => (
            <li key={i}>
              <span className="audit-type">{entry.type}</span>{" "}
              <span className="mono">
                {entry.voter.slice(0, 6)}…{entry.voter.slice(-4)}
              </span>{" "}
              {entry.detail}
              <a
                className="tx-link"
                href={`https://sepolia.etherscan.io/tx/${entry.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                view tx
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
