# Sepolia deployment

| | |
|---|---|
| Contract | `VotingSystem` |
| Address | [`0x8ac06B48C108B011a89b3269b30d52721aEf1c64`](https://sepolia.etherscan.io/address/0x8ac06B48C108B011a89b3269b30d52721aEf1c64) |
| Network | Sepolia (chain ID `11155111`) |
| Deployer | `0x5dc77cEfCf8Fc99b9E03c916701AEcCf80288aeA` |
| Source verified | ✅ [view on Etherscan](https://sepolia.etherscan.io/address/0x8ac06B48C108B011a89b3269b30d52721aEf1c64#code) |
| Deployed | 2026-08-29 |

`frontend/src/contracts/VotingSystem.json` holds this same address, chain ID and
ABI — it's what the live frontend reads, and what the GitHub Pages workflow
checks before it will publish.

To redeploy (e.g. after a contract change), from the project root:

```bash
npm run deploy:sepolia
npx hardhat verify --network sepolia <new address>
```

then update the table above and commit the regenerated `VotingSystem.json`.
