import * as fs from "fs";
import * as path from "path";

import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { resolveHederaContractId } from "../utils/resolveHederaContractId";

const HEDERA_CHAIN_IDS = new Set([295, 296]);

const deployFileRegistry: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployment = await deploy("FileRegistry", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
    gasLimit: "3000000",
    gasPrice: await getDeployGasPrice(hre),
  });

  const chainId = await hre.network.provider.send("eth_chainId", []);
  const numericChainId = Number(chainId);

  if (HEDERA_CHAIN_IDS.has(numericChainId) && deployment.address) {
    const hederaContractId = await resolveHederaContractId(deployment.address, numericChainId);
    const deploymentPath = path.join(hre.config.paths.deployments, hre.network.name, "FileRegistry.json");
    const deploymentJson = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Record<string, unknown>;
    deploymentJson.hederaContractId = hederaContractId;
    fs.writeFileSync(deploymentPath, `${JSON.stringify(deploymentJson, null, 2)}\n`);
    console.log(`Resolved Hedera contract id: ${hederaContractId}`);
  }
};

deployFileRegistry.tags = ["FileRegistry"];
export default deployFileRegistry;
