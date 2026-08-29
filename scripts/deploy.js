const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying VotingSystem with account:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const VotingSystem = await hre.ethers.getContractFactory("VotingSystem");
  const voting = await VotingSystem.deploy();
  await voting.waitForDeployment();

  const address = await voting.getAddress();
  const deployBlock = (await voting.deploymentTransaction().wait()).blockNumber;
  console.log("VotingSystem deployed to:", address, "at block", deployBlock);
  console.log("Network:", hre.network.name);

  // write the address + ABI where the frontend reads it
  const artifact = await hre.artifacts.readArtifact("VotingSystem");
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId ?? null,
    address,
    deployer: deployer.address,
    deployedAtBlock: deployBlock,
    abi: artifact.abi,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "frontend", "src", "contracts");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "VotingSystem.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("Wrote frontend/src/contracts/VotingSystem.json");

  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log(
      "\nTo verify on Etherscan, run:\n" +
        `  npx hardhat verify --network ${hre.network.name} ${address}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
