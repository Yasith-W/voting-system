# Decentralized Voting System

Coursework for DAS5003 Blockchain Fundamentals (PRAC1, Section 3, Option B).

A voting DApp where authorised organisers run elections, whitelisted addresses
vote once (and can change their vote before the deadline), and the smart
contract keeps the tally. Solidity contract, React + MetaMask frontend.

## What the contract does

| Requirement | How it's done |
| --- | --- |
| Only authorised users create elections | `createElection` sits behind the `onlyAuthorisedOrganiser` modifier; the owner manages the organiser list |
| Only verified addresses vote | each election has its own voter whitelist (`registerVoter` / `registerVoters`), closed once the election ends |
| No double voting | `castVote` reverts if the address has already voted |
| Change your vote before the deadline | `changeVote` moves your vote to another option; blocked once voting closes |
| Everything recorded on-chain | `ElectionCreated`, `VoterRegistered`, `VoteCast`, `VoteChanged` events |
| Automatic results | `getResults` returns the per-option counts; `getWinningOption` returns the winner and flags ties |
| Transparent | all state is public; the frontend builds an audit log from the events |

## Layout

```
contracts/VotingSystem.sol    the contract
test/VotingSystem.test.js     44 tests, 100% branch coverage (see TEST-EVIDENCE.md)
scripts/deploy.js             deploys, then writes the address + ABI for the frontend
frontend/                     React + Vite + ethers.js UI
```

## Running it

Needs Node 18+, npm, and the MetaMask browser extension.

```bash
npm install
cd frontend && npm install && cd ..
```

Compile and test:

```bash
npm run compile
npm test
npm run test:gas    # same tests, plus a gas report
```

### Local chain

```bash
npm run node            # terminal 1: local chain with funded accounts
npm run deploy:local    # terminal 2
cd frontend && npm run dev
```

Add the local network to MetaMask (RPC `http://127.0.0.1:8545`, chain ID
`31337`) and import a private key printed by `npm run node`.

### Sepolia

Copy `.env.example` to `.env` and fill in:

- `SEPOLIA_RPC_URL` – from Alchemy or Infura
- `PRIVATE_KEY` – a throwaway wallet with some Sepolia test ETH, never a real one
  ([faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia))
- `ETHERSCAN_API_KEY` – optional, for verification

```bash
npm run deploy:sepolia
npx hardhat verify --network sepolia <address>
```

`deploy.js` writes the address and ABI to
`frontend/src/contracts/VotingSystem.json`, so the frontend picks it up.

**Live deployment:** [`0x5214E2b578A9147eE625B5dD362f5880921Bda28`](https://sepolia.etherscan.io/address/0x5214E2b578A9147eE625B5dD362f5880921Bda28#code)
on Sepolia, source verified.

## Using the app

Connect MetaMask. The deployer is an organiser by default and sees the **Create
an election** form; `authorizeOrganiser` adds more. An organiser registers voter
addresses on each election card, registered voters cast or change their vote
while it's open, and the audit-log toggle shows the on-chain history.

## Live demo

**https://yasith-w.github.io/voting-system/**

`.github/workflows/pages.yml` builds the frontend and publishes it here on
every push to `main` that touches `frontend/`. It only publishes once a real
Sepolia address is committed to `VotingSystem.json` (already the case) —
otherwise the workflow runs green but skips the publish step.

## Team

| Member | Role |
| --- | --- |
| Yasith | Project lead, smart contract, deployment |
| Isuru | Frontend and wallet integration |
| Vethum | Tests and QA |

## For the report

The four discussion points, and what the code already shows:

- **Security** – access control in layers (owner → organiser list → per-election
  organiser), every input checked with `require`, no external calls so no
  re-entrancy risk.
- **Gas** – the tally lives in a mapping and is updated per vote, so cost doesn't
  grow with turnout; `registerVoters` batches registrations into one transaction.
  Measured: `castVote` ~70k–124k, `createElection` ~250k, deployment ~1.7M gas.
- **Scalability** – reads are free, only writes cost gas. A Merkle whitelist would
  scale better than registering voters one at a time.
- **Trust** – a cast vote can't be altered, the contract does the counting rather
  than a server, and every action is verifiable from the event log.

Each member also writes their own reflection, submitted separately.
