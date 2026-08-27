# Decentralized Voting System

A blockchain-based voting and governance DApp built for **DAS5003 Blockchain
Fundamentals — PRAC1, Section 3, Option B** (Cardiff School of Technologies /
ICBT, 2026 Semester 1).

Authorised organisers create elections, whitelisted addresses cast one vote
each (which they may change up to the deadline), and results are tallied and
displayed automatically — all enforced by a Solidity smart contract, with a
React + MetaMask frontend on top.

## Requirements coverage

| Brief requirement | Where it's implemented |
| --- | --- |
| Authorized users create elections/campaigns | `authorizeOrganiser` / `onlyAuthorisedOrganiser` + `createElection` in [`contracts/VotingSystem.sol`](contracts/VotingSystem.sol) |
| Verified addresses vote | Per-election `eligibleVoters` whitelist, set via `registerVoter(s)` |
| No duplicate voting | `hasVoted` mapping — `castVote` reverts if the address has already voted |
| Voters can change their vote before the deadline | dedicated `changeVote` function moves the voter's single counted vote between options; reverts once `endTime` passes |
| Immutable, on-chain activity record | `ElectionCreated`, `VoterRegistered`, `VoteCast`, `VoteChanged` events, surfaced in the frontend's audit log |
| Automatic result tallying | `voteCounts` mapping updated on every vote; `getResults()` returns live totals and `getWinningOption()` computes the winner (with tie detection) on-chain |
| Transparency & auditability | All state is publicly readable (`getElection`, `getResults`, `getVoterChoice`, event logs) |
| Smart contract manages all logic | Eligibility, timing and tallying are enforced entirely on-chain via modifiers/requires |
| MetaMask / wallet integration | `frontend/src/hooks/useVotingContract.js` (connect, sign, account/network-change handling, wrong-network detection with one-click switch) |

## Project structure

```
voting-system/
├── contracts/
│   └── VotingSystem.sol       # the voting smart contract
├── test/
│   └── VotingSystem.test.js   # Hardhat/Chai unit tests (happy paths + reverts)
├── scripts/
│   └── deploy.js              # deploys the contract and writes its ABI/address for the frontend
├── frontend/                  # React + Vite + ethers.js DApp UI
│   └── src/
│       ├── App.jsx
│       ├── components/        # CreateElectionForm, ElectionCard, Dashboard
│       ├── hooks/useVotingContract.js
│       └── contracts/         # ABI + deployed address (written by scripts/deploy.js)
├── hardhat.config.js
└── package.json
```

## Prerequisites

- Node.js 18+ and npm
- [MetaMask](https://metamask.io/) browser extension
- Sepolia test ETH from a faucet (e.g. the [Google Cloud Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [sepoliafaucet.com](https://sepoliafaucet.com/)) if deploying to a public testnet
- An RPC URL for Sepolia (e.g. from [Infura](https://infura.io/) or [Alchemy](https://www.alchemy.com/)) if deploying to a public testnet

## 1. Install dependencies

```bash
# from the project root — installs Hardhat, OpenZeppelin, etc.
npm install

# the frontend has its own dependency set
cd frontend
npm install
cd ..
```

## 2. Compile and test the contract

```bash
npm run compile
npm test
```

The test suite (`test/VotingSystem.test.js`) covers organiser authorisation,
election creation, voter registration, first-time voting, vote changes,
duplicate-vote prevention, out-of-range options, voting outside the election
window, on-chain winner calculation (clear winner, tie, no votes), and
read-side transparency/auditability functions — 33 tests, all passing.

To see per-function gas costs (useful for the report's gas-fees discussion):

```bash
npm run test:gas
```

## 3. Run a local blockchain and deploy

In one terminal, start a local Hardhat node (this gives you 20 funded test
accounts you can import into MetaMask for local testing):

```bash
npm run node
```

In a second terminal, deploy to it:

```bash
npm run deploy:local
```

This writes the deployed address and ABI to
`frontend/src/contracts/VotingSystem.json`, which the frontend reads
automatically.

To connect MetaMask to the local node: add a network with RPC URL
`http://127.0.0.1:8545` and chain ID `31337`, then import one of the private
keys printed by `npm run node`.

## 4. Deploy to the Sepolia testnet

```bash
cp .env.example .env
# edit .env and fill in SEPOLIA_RPC_URL and PRIVATE_KEY (a wallet funded with
# Sepolia test ETH — never use a real-funds private key here)

npm run deploy:sepolia
```

Optionally verify the contract on Etherscan (needs `ETHERSCAN_API_KEY` in
`.env`):

```bash
npx hardhat verify --network sepolia <deployed address>
```

## 5. Run the frontend

```bash
cd frontend
npm run dev
```

Open the printed local URL, click **Connect MetaMask**, and:

- If your connected account is an authorised organiser (the deployer is
  authorised by default — see `authorizeOrganiser` to add teammates), you'll
  see a **Create an election** form.
- Each election card lets its organiser register voter addresses, and lets
  registered voters cast or change their vote while the election is open.
- Every election card has a **Show on-chain audit log** toggle that reads
  the contract's events directly.

## 6. Publish the demo to GitHub Pages (optional)

`.github/workflows/pages.yml` builds the frontend and deploys it to GitHub
Pages on every push to `main` that touches `frontend/`. Two one-time steps:

1. In the repo, **Settings → Pages → Source → GitHub Actions**.
2. Deploy the contract to Sepolia first (`npm run deploy:sepolia`) and commit
   the updated `frontend/src/contracts/VotingSystem.json`. The workflow refuses
   to publish until a real Sepolia address is present.

The published site is served from `/voting-system/` (handled by
`GITHUB_PAGES=true` in `frontend/vite.config.js`).

## Team roles

| Member | Role | Key contributions |
| --- | --- | --- |
| Yasith | Project Lead / Backend | `VotingSystem.sol` smart contract (election lifecycle, whitelist, `castVote`/`changeVote`, on-chain tally + `getWinningOption`), Hardhat setup, deployment scripts, project coordination |
| Isuru | Frontend | React + ethers.js DApp UI (`CreateElectionForm`, `ElectionCard`, `Dashboard`), MetaMask/wallet hook, wrong-network handling, on-chain audit-log view |
| Vethum | QA Testing | Hardhat/Chai test suite (`test/VotingSystem.test.js`), failure-case coverage (double-vote, voting outside the window, tie handling), gas reporting, testnet verification |

## Security, gas, scalability & trust (report discussion notes)

These are starting points for the technical report's required discussion —
expand on each with your own analysis and citations:

- **Security** — access control is layered (`Ownable` for the contract
  owner, a separate `authorisedOrganisers` whitelist, and per-election
  `onlyElectionOrganiser` checks); all state changes happen before any
  external interaction (there are none here, so re-entrancy is not a
  practical risk); every external input is validated with `require`.
- **Gas fees** — vote tallies are updated incrementally in a mapping rather
  than recomputed by looping over all votes, so `castVote` and `getResults`
  cost the same gas regardless of how many people have voted; batch voter
  registration (`registerVoters`) amortises transaction overhead across many
  addresses in one call.
- **Scalability** — reads (results, audit log) are free off-chain calls;
  the only costs are the writes (create election, register voter, cast
  vote). For very large elections, consider a Merkle-proof-based voter
  whitelist instead of individual `registerVoter` transactions.
- **Decentralized trust** — no party can alter a cast vote once recorded,
  outcomes are computed by the contract rather than a trusted server, and
  every action is independently verifiable on-chain via the emitted events.

## Individual reflections

Per the brief, each team member should write a short, specific reflection
(technical tasks completed, challenges faced and how they were resolved,
skills gained, and teamwork experience) and submit it individually — this is
marked separately from the group build.
