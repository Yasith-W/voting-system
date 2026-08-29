# Test evidence

Captured 2026-08-29 against the deployed contract's exact source
(`0x5214E2b578A9147eE625B5dD362f5880921Bda28` on Sepolia). Reproduce with
`npm test`, `npm run coverage`, `npm run test:gas`.

## Test run — `npx hardhat test`

```
VotingSystem
    Organiser authorisation
      ✔ sets the deployer as an authorised organiser by default
      ✔ lets the owner authorise a new organiser
      ✔ lets the owner revoke an organiser
      ✔ reverts when a non-owner tries to authorise an organiser
      ✔ reverts when a non-owner tries to revoke an organiser
      ✔ rejects authorising the zero address
    Creating elections
      ✔ allows an authorised organiser to create an election
      ✔ rejects election creation from an address that is not an authorised organiser
      ✔ rejects an election with fewer than two options
      ✔ rejects an election whose end time is not after its start time
      ✔ rejects an empty title
      ✔ rejects an election that is already over (both times in the past)
    Voter registration
      ✔ lets the election's organiser register a voter
      ✔ supports batch registration
      ✔ does not double-count or re-emit when registering the same voter twice
      ✔ rejects registering a voter once the election has closed
      ✔ rejects registration from someone other than that election's organiser
      ✔ reverts when registering a voter for a non-existent election
      ✔ rejects registering the zero address as a voter
      ✔ rejects batch registration for a non-existent election
      ✔ rejects batch registration from someone other than that election's organiser
    Casting and changing votes
      ✔ records a first-time vote and emits VoteCast
      ✔ prevents an address that is not whitelisted from voting
      ✔ reverts castVote and changeVote for a non-existent election
      ✔ rejects a second castVote from the same address (must use changeVote)
      ✔ prevents duplicate voting from counting twice — changeVote just moves the vote
      ✔ emits VoteChanged when a voter updates their choice
      ✔ rejects changeVote before the address has cast a vote
      ✔ rejects changeVote to the option the voter already holds
      ✔ rejects changeVote from an address that is not whitelisted
      ✔ rejects an out-of-range option index on castVote and changeVote
      ✔ rejects votes cast before the election has started
      ✔ rejects votes and vote changes after the deadline has passed
    Results, transparency and auditability
      ✔ automatically tallies results across multiple voters
      ✔ exposes full election details for auditability
      ✔ reverts getVoterChoice for an address that has not voted
      ✔ reverts getElection, getResults and isVotingOpen for a non-existent election
      ✔ reports whether voting is currently open
    On-chain winner calculation (getWinningOption)
      ✔ reports no winner before any votes are cast
      ✔ identifies a clear winner
      ✔ flags a tie between options that share the top count
      ✔ clears the tie flag once one option pulls ahead
      ✔ tracks the winner updating after a changeVote
      ✔ reverts for a non-existent election

  44 passing (1s)
```

Failure cases explicitly covered (double-vote, voting after the deadline, and
others beyond the brief's two named examples): already-voted rejection,
change-before-first-vote rejection, out-of-range option index, ineligible
voter, wrong caller for organiser-only actions, zero-address inputs,
non-existent election IDs on every function that takes one, and registering
a voter after an election has closed.

## Coverage — `npm run coverage`

```
-------------------|----------|----------|----------|----------|----------------|
File               |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-------------------|----------|----------|----------|----------|----------------|
 contracts\        |      100 |      100 |      100 |      100 |                |
  VotingSystem.sol |      100 |      100 |      100 |      100 |                |
-------------------|----------|----------|----------|----------|----------------|
All files          |      100 |      100 |      100 |      100 |                |
-------------------|----------|----------|----------|----------|----------------|
```

100% of statements, branches, functions and lines are exercised by the suite
— every `require`, every modifier's pass/fail path, and every function.

## Gas — `npm run test:gas`

Solc 0.8.24, optimizer enabled (200 runs), Sepolia block limit ~60,000,000 gas.

| Method | Min | Max | Avg | Calls |
|---|---|---|---|---|
| `castVote` | 70,028 | 124,140 | 102,269 | 22 |
| `changeVote` | 70,157 | 82,457 | 79,382 | 4 |
| `createElection` | 213,558 | 254,280 | 253,633 | 63 |
| `registerVoter` | 30,901 | 75,019 | 60,307 | 6 |
| `registerVoters` (batch) | — | — | 127,793 | 24 |
| **Deployment** | — | — | 1,735,369 | 2.9% of block limit |

## Continuous integration

`.github/workflows/test.yml` runs this exact suite on every push to `main`
and every pull request — see the Actions tab for the live history rather
than trusting this snapshot alone.
