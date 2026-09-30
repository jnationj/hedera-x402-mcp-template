import hre from "hardhat";

/**
 * Verify contracts deployed with hardhat-deploy on the active network.
 * Reads addresses from `deployments/<network>/` and submits to Sourcify via
 * `@nomicfoundation/hardhat-verify` (see `sourcify` in hardhat.config.ts).
 *
 * Skips stale deployment records that no longer have compiled artifacts in this repo.
 */
async function main() {
  const all = await hre.deployments.all();
  const names = Object.keys(all).sort();

  if (names.length === 0) {
    throw new Error(
      `No deployments found for "${hre.network.name}". Run \`yarn hardhat:deploy --network ${hre.network.name}\` first.`,
    );
  }

  let verified = 0;

  for (const name of names) {
    try {
      await hre.artifacts.readArtifactSync(name);
    } catch {
      console.log(`Skipping ${name} — no artifact in this project (stale deployment record).`);
      continue;
    }

    const { address, args } = all[name];
    console.log(`\nVerifying ${name} at ${address}...`);

    await hre.run("verify", {
      address,
      constructorArguments: args ?? [],
    });

    verified++;
  }

  if (verified === 0) {
    throw new Error(
      `No verifiable deployments on "${hre.network.name}". Deploy FileRegistry or remove stale records under deployments/.`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
