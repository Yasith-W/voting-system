import { useCallback, useEffect, useState } from "react";
import { DEPLOY_BLOCK } from "../contracts/config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Some RPC providers (Alchemy's free tier included) reject eth_getLogs calls
// that span too wide a block range, and separately rate-limit how many
// requests land per second — and a few silently return an empty/partial
// result for a wide range instead of erroring at all. So: scan in fixed,
// deliberately modest windows from the start (don't gamble on a provider
// handling a huge range well), retry with backoff on a rate limit, and if a
// provider still won't accept even a modest window, halve it and retry.
// Everything runs one call at a time, never in parallel, to stay under
// per-second caps.
//
// Fetches every log for the contract in one pass (not per event type) —
// four separate scans would each rediscover the same limits independently
// and take four times as long.
const WINDOW_SIZE = 400;

async function fetchLogsInWindow(provider, address, fromBlock, toBlock, retries = 0) {
  await sleep(250);
  try {
    return await provider.getLogs({ address, fromBlock, toBlock });
  } catch (err) {
    if (err?.info?.error?.code === 429 && retries < 8) {
      await sleep(Math.min(1000 * 2 ** retries, 8000));
      return fetchLogsInWindow(provider, address, fromBlock, toBlock, retries + 1);
    }
    if (toBlock <= fromBlock) throw err;
    const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2);
    const left = await fetchLogsInWindow(provider, address, fromBlock, mid);
    const right = await fetchLogsInWindow(provider, address, mid + 1, toBlock);
    return [...left, ...right];
  }
}

async function fetchAllLogs(provider, address, fromBlock, toBlock) {
  const all = [];
  for (let start = fromBlock; start <= toBlock; start += WINDOW_SIZE) {
    const end = Math.min(start + WINDOW_SIZE - 1, toBlock);
    all.push(...(await fetchLogsInWindow(provider, address, start, end)));
  }
  return all;
}

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
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [auditScanCount, setAuditScanCount] = useState(null);
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
    setAuditLoading(true);
    setAuditError(null);
    try {
      const provider = contract.runner.provider;
      const latestBlock = await provider.getBlockNumber();

      const rawLogs = await fetchAllLogs(provider, contract.target, DEPLOY_BLOCK, latestBlock);
      setAuditScanCount(rawLogs.length);
      console.log(
        `[audit log] scanned blocks ${DEPLOY_BLOCK}-${latestBlock}, found ${rawLogs.length} raw log(s) at this address`
      );

      const entries = rawLogs
        .map((log) => {
          try {
            return { log, event: contract.interface.parseLog(log) };
          } catch {
            return null; // a log from another contract at this address, or one we don't know
          }
        })
        .filter((p) => p && "electionId" in p.event.args && Number(p.event.args.electionId) === electionId)
        .map(({ log, event }) => {
          if (event.name === "VoteCast") {
            return {
              type: "Vote cast",
              voter: event.args.voter,
              detail: `chose "${details?.options?.[Number(event.args.optionIndex)] ?? event.args.optionIndex}"`,
              txHash: log.transactionHash,
            };
          }
          if (event.name === "VoteChanged") {
            return {
              type: "Vote changed",
              voter: event.args.voter,
              detail: `${details?.options?.[Number(event.args.previousOptionIndex)] ?? event.args.previousOptionIndex} → ${
                details?.options?.[Number(event.args.newOptionIndex)] ?? event.args.newOptionIndex
              }`,
              txHash: log.transactionHash,
            };
          }
          if (event.name === "VoterRegistered") {
            return { type: "Voter registered", voter: event.args.voter, detail: "", txHash: log.transactionHash };
          }
          return null;
        })
        .filter(Boolean);

      setAuditLog(entries);
    } catch (err) {
      console.error(err);
      setAuditError(
        err?.shortMessage || err?.message || "Couldn't load the audit log from your wallet's RPC."
      );
    } finally {
      setAuditLoading(false);
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
      </button>{" "}
      <a
        className="tx-link small"
        href={`https://sepolia.etherscan.io/address/${contract.target}#events`}
        target="_blank"
        rel="noreferrer"
      >
        view all events on Etherscan
      </a>

      {showAudit && (
        <>
          {auditLoading && (
            <p className="muted small">
              Loading audit log… some networks rate-limit this and it can take up to a minute.
            </p>
          )}
          {auditError && (
            <p className="error small">
              {auditError} Check the "view all events on Etherscan" link above instead.
            </p>
          )}
          {!auditLoading && !auditError && (
            <ul className="audit-log">
              {auditLog.length === 0 && (
                <li className="muted small">
                  No activity recorded yet.
                  {auditScanCount != null && ` (scanned ${auditScanCount} raw log entr${auditScanCount === 1 ? "y" : "ies"} at this address)`}
                </li>
              )}
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
        </>
      )}
    </div>
  );
}
