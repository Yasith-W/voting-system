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
  console.log("VotingSystem deployed to:", address);
  console.log("Network:", hre.network.name);

  // Save the address + ABI for the frontend to pick up.
  const artifact = await hre.artifacts.readArtifact("VotingSystem");
  const deploymentInfo = {
    network: hre.network.name,
    address,
    deployer: deployer.address,
    abi: artifact.abi,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "frontend", "src", "contracts");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "VotingSystem.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("Wrote frontend/src/contracts/VotingSystem.json for the frontend to use.");

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
