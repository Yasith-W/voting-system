# Technical report — outline

Working outline for the PRAC1 Section 3 report. Fill in prose under each
heading; the bullets are the facts/figures to build it around.

## 1. Introduction

- What the system is, who it's for (DAS5003 PRAC1, Option B), one paragraph.
- High-level architecture: Solidity contract on Sepolia, React + ethers.js
  frontend hosted on GitHub Pages, MetaMask as the wallet.

## 2. Design decisions

- **Data model** — one `Election` struct per campaign (options, start/end
  time, organiser); per-election mappings for eligibility, `hasVoted`,
  each voter's choice, and per-option tallies.
- **Access control, in layers** — contract owner (`Ownable`) → organiser
  whitelist (`authorizeOrganiser`/`revokeOrganiser`) → per-election organiser
  check on registration. No single hardcoded admin.
- **Voting** — `castVote` for a first vote, `changeVote` to switch before the
  deadline; both blocked once `endTime` passes. One address only ever counts
  once — a change moves the tally, it doesn't add to it.
- **Results** — `getResults` for the live per-option counts, `getWinningOption`
  for the leader and a tie flag, both computed on-chain rather than in the
  frontend.
- **Events as the audit trail** — every create/register/cast/change is logged;
  nothing is ever deleted, so the full history is reconstructable from logs
  alone.
- **Trade-off to call out explicitly**: `getVoterChoice` makes every vote
  publicly attributable to an address. Good for auditability, bad for ballot
  secrecy — a reasonable choice for transparent governance voting, not for a
  secret-ballot election. Worth a paragraph on what a secret-ballot version
  would need (commit-reveal, or ZK proofs).
- **Other decisions worth a sentence each**: voter registration stays open
  after voting starts (operational flexibility over strict integrity); an
  election can be created already open; `registerVoters` re-checks its
  modifiers per address for simplicity over a small gas saving.

## 3. Discussion topics

### Security
- Layered access control (above).
- Every external input validated with `require`.
- No external calls and the contract holds no funds — no re-entrancy surface.
- Solidity 0.8 checked arithmetic (no manual overflow guards needed).
- Residual risk: the owner is a single key. Worth mentioning a multisig owner
  as the production fix.

### Gas fees
Measured with the Hardhat gas reporter:

| Function | Gas |
|---|---|
| `createElection` | ~214k–254k |
| `castVote` | ~70k–124k (cold first voter) |
| `changeVote` | ~70k–82k |
| `registerVoter` | ~50k |
| `registerVoters` (batch) | ~101k |
| Deployment | ~1.69M (2.8% of block limit) |

- Tallies live in a mapping and update per vote, so `castVote`/`getResults`
  cost stays flat regardless of turnout — no loop over all voters.
- Batch registration amortises overhead across many addresses in one tx.

### Scalability
- Reads (`getResults`, `getWinningOption`, the audit log) are free off-chain
  calls; only writes cost gas.
- Registering voters one-by-one is O(n) transactions — a Merkle-root
  whitelist would collapse that to a single write plus off-chain proofs.
- An L2 deployment would cut per-vote cost further for a larger electorate.

### Decentralised trust
- No central server tallies votes — anyone can recompute the result from
  `voteCounts` or the event log.
- Etherscan-verified source lets anyone confirm the deployed bytecode matches
  this repo.
- Residual trust: the owner picks organisers, organisers pick their voters.
  A DAO-governed owner or on-chain eligibility criteria would reduce that.

## 4. Testing and evidence

- 33 Hardhat/Chai tests, covering: organiser authorisation, election
  creation and validation, voter registration, casting and changing votes,
  duplicate-vote and post-deadline rejection, and on-chain winner
  calculation (clear winner, tie, no votes cast).
- `npm run test:gas` produces the table above.

## 5. Deployment

- Live on Sepolia: `0x8ac06B48C108B011a89b3269b30d52721aEf1c64`, source
  verified on Etherscan.
- Frontend published via GitHub Pages, built straight from the same repo.

## 6. Conclusion

- Summarise: all 8 brief requirements met, tested, deployed, and documented.
- One or two sentences on what a production version would add (Merkle
  whitelist, multisig owner, secret ballots).
