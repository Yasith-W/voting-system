# Requirements compliance checklist

DAS5003 PRAC1 — Section 3, Task 3.1(b): Decentralized Voting and Governance System.

This document maps every requirement in the PRAC1 brief to the code that
satisfies it. Line numbers refer to [`contracts/VotingSystem.sol`](../contracts/VotingSystem.sol)
unless stated otherwise. Test names refer to [`test/VotingSystem.test.js`](../test/VotingSystem.test.js)
(**33 tests, all passing**).

---

## 1. Functional requirements (PRAC1 brief)

### 1. Allow authorized users to create elections or voting campaigns — ✅

- `createElection(...)` is gated by the `onlyAuthorisedOrganiser` modifier
  (`createElection` decl. L137–142; modifier L82–88).
- The organiser set is a mapping (`authorisedOrganisers`, L47), managed by the
  contract owner via `authorizeOrganiser` / `revokeOrganiser` (L115–125) — not a
  single hardcoded admin.
- The deployer is authorised in the constructor (L73–76).
- Input validation on creation: non-empty title, ≥2 options, `endTime > startTime`,
  `endTime` in the future (L143–146).
- Frontend: `App.jsx` only renders `CreateElectionForm` when
  `contract.authorisedOrganisers(account)` is true.
- Tests: *"allows an authorised organiser to create an election"*,
  *"rejects election creation from an address that is not an authorised organiser"*,
  *"rejects an election with fewer than two options"*,
  *"rejects an election whose end time is not after its start time"*.

### 2. Allow verified blockchain addresses to vote — ✅

- Per-election whitelist `eligibleVoters[electionId][voter]` (L38).
- Populated by `registerVoter` / `registerVoters`, both gated by
  `onlyElectionOrganiser` (L164–184).
- `castVote` and `changeVote` both require `eligibleVoters[electionId][msg.sender]`
  (L200–203, L231–234).
- Frontend: `ElectionCard` only shows vote buttons when `contract.isEligible(...)`
  returns true.
- Tests: *"prevents an address that is not whitelisted from voting"*,
  *"rejects changeVote from an address that is not whitelisted"*,
  *"lets the election's organiser register a voter"*, *"supports batch registration"*,
  *"rejects registration from someone other than that election's organiser"*.

### 3. Prevent duplicate voting from the same address — ✅

- `hasVoted[electionId][voter]` mapping (L40).
- `castVote` reverts with *"already voted - use changeVote to update your vote"*
  if the caller has already voted (L204–207).
- `changeVote` moves the caller's single counted vote between options
  (`voteCounts[prev] -= 1; voteCounts[new] += 1`, L247–249) — the tally never
  gains a second vote for one address.
- Invariant: total counted votes == number of distinct voters
  (`totalVotesCast`, incremented only in `castVote`, L216).
- Tests: *"rejects a second castVote from the same address (must use changeVote)"*,
  *"prevents duplicate voting from counting twice — changeVote just moves the vote"*
  (asserts the summed tally stays at 1 after a change).

### 4. Allow voters to modify their vote before the deadline — ✅

- Dedicated `changeVote(electionId, newOptionIndex)` function (L226–252).
- Guarded by `withinVotingPeriod` (L103–108): reverts with
  *"voting deadline has passed"* once `block.timestamp > endTime`.
- Reverts if the caller has not yet voted (*"no vote to change - use castVote first"*,
  L235–238) and if the new option equals the current one (L245).
- Emits `VoteChanged(electionId, voter, previousOptionIndex, newOptionIndex, timestamp)`.
- Frontend: `ElectionCard` "Change vote to this" button routes to `changeVote`.
- Tests: *"emits VoteChanged when a voter updates their choice"*,
  *"rejects changeVote before the address has cast a vote"*,
  *"rejects changeVote to the option the voter already holds"*,
  *"rejects votes and vote changes after the deadline has passed"*.

### 5. Record all voting activity immutably on-chain — ✅

- Events: `ElectionCreated` (L51–57), `VoterRegistered` (L58), `VoteCast` with
  timestamp (L59–64), `VoteChanged` with previous + new option + timestamp
  (L65–71), `OrganiserAuthorized` / `OrganiserRevoked` (L49–50).
- No function deletes or rewrites history. A vote change adjusts the live tally
  but emits a `VoteChanged` record — the full sequence of every cast and change
  is permanently reconstructable from logs.
- Frontend: `ElectionCard`'s "Show on-chain audit log" reads `VoteCast`,
  `VoteChanged` and `VoterRegistered` events directly via `contract.queryFilter`.
- Design note: the *current* choice is in mutable state (`voterChoice`), but the
  *history* is in the append-only event log — the standard Ethereum pattern.

### 6. Automatically calculate and display election results — ✅

- `voteCounts[electionId][optionIndex]` is updated incrementally on every cast /
  change (L215, L247–248) — never recomputed by looping over voters.
- `getResults(electionId)` returns `(string[] options, uint256[] counts)`
  (L278–290).
- `getWinningOption(electionId)` computes the winner **on-chain**: returns
  `(winningIndex, winningLabel, winningVotes, tie)` (L302–321). `tie` is true when
  ≥2 options that each have ≥1 vote share the top count.
- Frontend: `ElectionCard` renders a live per-option bar chart, "Currently
  leading / tied" while open, and "Winner: X — n votes" / "tied" / "no votes were
  cast" once closed.
- Tests: *"automatically tallies results across multiple voters"* plus the
  *"On-chain winner calculation (getWinningOption)"* block — clear winner, tie,
  no votes, tie-then-lead, winner-after-changeVote, non-existent election.

### 7. Provide transparency and auditability of votes — ✅

- Every piece of state is publicly readable: `getElection`, `getResults`,
  `getWinningOption`, `isEligible`, `hasAddressVoted`, `getVoterChoice`,
  `isVotingOpen`, `electionCount`, `authorisedOrganisers`.
- Full event log (requirement 5) + planned Etherscan source verification.
- **Design decision to document in the report:** `getVoterChoice(electionId, voter)`
  (L334–337) exposes exactly how each address voted. This maximises auditability
  at the cost of ballot secrecy — appropriate for transparent governance votes
  (e.g. DAO / board voting), not for secret-ballot political elections. A
  production secret-ballot system would need commit–reveal or zero-knowledge
  proofs.

### 8. Use smart contracts to manage election logic and voting rules — ✅

- All rules — organiser authorisation, per-election eligibility, voting window,
  one-counted-vote, tally maintenance, winner calculation — are enforced in
  Solidity through modifiers (`onlyAuthorisedOrganiser`, `onlyElectionOrganiser`,
  `electionExists`, `withinVotingPeriod`) and `require` statements.
- The React frontend is a thin client: it never computes results or gates
  actions in a trust-bearing way; the contract rejects anything invalid.

---

## 2. Option B marking breakdown

| Requirement | Marks | Implementing code | Tests | Status |
|---|---|---|---|---|
| Election creation — authorised organisers create campaigns | 15 | `createElection` + `onlyAuthorisedOrganiser` + owner whitelist | 4 | ✅ |
| Verified voting — only whitelisted addresses can vote | 15 | `eligibleVoters` + `registerVoter(s)` + eligibility checks | 5 | ✅ |
| Duplicate prevention — no address votes twice | 15 | `hasVoted` + `castVote` revert + `changeVote` shift-only | 2 | ✅ |
| Editable vote — change choice before deadline | 15 | `changeVote` under `withinVotingPeriod` | 4 | ✅ |
| Immutable record — all activity stored and auditable on-chain | 20 | 6 event types, no destructive paths, frontend audit log | covered via event assertions across suite | ✅ |
| Automatic results — tally and outcomes computed in-contract | 20 | `voteCounts` + `getResults` + `getWinningOption` | 7 | ✅ |

---

## 3. Required discussion topics (report component, ~15%)

These are graded in the **technical report**, not the code — but the code already
provides the concrete material for each:

| Topic | Material in the codebase |
|---|---|
| Smart contract security | Layered access control (`Ownable` → `authorisedOrganisers` → `onlyElectionOrganiser`); exhaustive `require` input validation; checks-effects-interactions (no external calls, holds no funds → no re-entrancy surface); Solidity 0.8 checked arithmetic; write paths avoid unbounded loops. Known residual: owner centrality (see §4). |
| Gas fees | Measured (Hardhat gas reporter): `createElection` ~214k–254k, `castVote` ~70k–124k (cold first voter), `changeVote` ~70k–82k, `registerVoter` ~50k, `registerVoters` batch ~101k, deployment ~1.69M (2.8% of block limit). Incremental tally keeps `castVote`/`getResults` O(1) in turnout; `getWinningOption` is O(options), a small fixed bound. |
| Scalability | Reads (results, winner, audit log) are free off-chain calls. Only writes cost gas. Per-voter `registerVoter` is O(n) transactions — a Merkle-root whitelist would collapse that to one. `getResults` / `getWinningOption` scale with option count only. Event-based indexing (e.g. The Graph) for large audit logs. L2 deployment for cost. |
| Decentralized trust | No central tally server — results are deterministic and recomputable by anyone from `voteCounts` or the event log. Immutable audit trail. Etherscan-verified source. Residual trust: the contract owner controls the organiser whitelist, and each organiser controls their election's voter whitelist. Mitigations: multisig / DAO owner, on-chain eligibility criteria instead of a manual whitelist. |

---

## 4. Known design decisions & minor observations

Not defects — deliberate choices to record in the report:

1. **Voter registration is not frozen at `startTime`.** An organiser can add
   eligible voters while voting is open. Left open for demo/operational
   flexibility. If stricter integrity is wanted, add
   `require(block.timestamp < elections[electionId].startTime)` to `registerVoter`.
2. **`createElection` allows an election that is already open** (`startTime` in
   the past) — only `endTime > block.timestamp` is enforced. Convenient for
   demos; a real deployment might require `startTime >= block.timestamp`.
3. **`registerVoters` calls the public `registerVoter` per iteration**, so both
   its modifiers re-run each loop. Minor gas overhead traded for no code
   duplication.
4. **Ballot choices are public** via `getVoterChoice` — see requirement 7.
5. **`getWinningOption` returns `winningIndex = 0` when no votes exist.** Callers
   must check `winningVotes == 0` (the frontend does). Documented in NatSpec.

---

## 5. Deliverables status

| Deliverable | Status |
|---|---|
| Passing test suite covering core logic + failure cases (double-vote, vote-after-deadline) | ✅ 33 tests — both named failure cases present |
| Source code repo (contracts, frontend, tests) + README | ✅ present, includes the live Sepolia address |
| Deployed live on Sepolia with contract addresses recorded | ✅ `0x8ac06B48C108B011a89b3269b30d52721aEf1c64`, verified — see `docs/DEPLOYMENT.md` |
| Live demo hosting | ✅ `.github/workflows/pages.yml` now publishes to GitHub Pages on push to `main` (the Sepolia deployment gate is satisfied) |
| Technical report (design decisions + 4 discussion topics) | ❌ not written |
| Demo walkthrough of the full user journey | ❌ not written |
| Individual reflections (Task 3.2, one per member, submitted separately) | ❌ not written |
