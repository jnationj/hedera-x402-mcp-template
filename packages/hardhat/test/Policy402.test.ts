import { expect } from "chai";
import { ethers } from "hardhat";

const POLICY_LABEL = "Policy402:v1";
const PAYMENT_ASSET = "0.0.0";
const PAY_TO = "0.0.1234";
const PRICE_TINYBAR = 1_000_000n;

type PolicyTerms = {
  fileId: string;
  serviceId: string;
  validFrom: bigint;
  validUntil: bigint;
  paymentAsset: string;
  payTo: string;
  priceTinybar: bigint;
};

function toBytes(value: string): Uint8Array {
  return ethers.toUtf8Bytes(value);
}

function computeServiceIdFromDescriptor(canonicalServiceDescriptor: string): string {
  return ethers.keccak256(toBytes(canonicalServiceDescriptor));
}

function computePolicyId(serviceId: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes32"], [toBytes(POLICY_LABEL), serviceId]),
  );
}

function computePolicyHash(
  policyId: string,
  serviceId: string,
  owner: string,
  version: bigint,
  validFrom: bigint,
  validUntil: bigint,
  paymentAsset: string,
  payTo: string,
  priceTinybar: bigint,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes", "bytes32", "bytes32", "address", "uint256", "uint256", "uint256", "string", "string", "uint256"],
      [
        toBytes(POLICY_LABEL),
        policyId,
        serviceId,
        owner,
        version,
        validFrom,
        validUntil,
        paymentAsset,
        payTo,
        priceTinybar,
      ],
    ),
  );
}

async function deployPolicyFixture() {
  const [creator, alice, bob] = await ethers.getSigners();
  const FileRegistry = await ethers.getContractFactory("FileRegistry");
  const fileRegistry = await FileRegistry.deploy();
  await fileRegistry.waitForDeployment();

  const Policy402 = await ethers.getContractFactory("Policy402");
  const policy = await Policy402.deploy(await fileRegistry.getAddress());
  await policy.waitForDeployment();

  const registerFile = async (owner: typeof creator, objectKey: string) => {
    await fileRegistry
      .connect(owner)
      .registerFile(
        objectKey,
        PAY_TO,
        PRICE_TINYBAR,
        false,
        ethers.id(`file-content-${objectKey}`),
        `${objectKey}.txt`,
        "text/plain",
      );
    return fileRegistry.computeFileId(owner.address, objectKey);
  };

  const fileId = await registerFile(creator, "object-key-1");
  const descriptor = `api://files/${fileId}`;
  const serviceId = computeServiceIdFromDescriptor(descriptor);
  const latestBlock = await ethers.provider.getBlock("latest");
  const validFrom = BigInt(latestBlock!.timestamp - 60);
  const validUntil = validFrom + 86_400n;
  const paymentAsset = PAYMENT_ASSET;
  const payTo = PAY_TO;
  const priceTinybar = PRICE_TINYBAR;

  const createPolicy = (caller = creator, overrides: Partial<PolicyTerms> = {}) =>
    policy
      .connect(caller)
      .createPolicy(
        overrides.fileId ?? fileId,
        overrides.serviceId ?? serviceId,
        overrides.validFrom ?? validFrom,
        overrides.validUntil ?? validUntil,
        overrides.paymentAsset ?? paymentAsset,
        overrides.payTo ?? payTo,
        overrides.priceTinybar ?? priceTinybar,
      );

  return {
    policy,
    fileRegistry,
    creator,
    alice,
    bob,
    fileId,
    descriptor,
    serviceId,
    validFrom,
    validUntil,
    paymentAsset,
    payTo,
    priceTinybar,
    registerFile,
    createPolicy,
  };
}

describe("Policy402", function () {
  it("deploys with a bound FileRegistry and creates a file-scoped policy", async function () {
    const {
      policy,
      fileRegistry,
      creator,
      fileId,
      serviceId,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
      createPolicy,
    } = await deployPolicyFixture();
    expect(await policy.fileRegistry()).to.equal(await fileRegistry.getAddress());

    const policyId = computePolicyId(serviceId);
    const expectedHash = computePolicyHash(
      policyId,
      serviceId,
      creator.address,
      1n,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
    );
    await expect(createPolicy())
      .to.emit(policy, "PolicyCreated")
      .withArgs(
        policyId,
        fileId,
        serviceId,
        creator.address,
        1n,
        expectedHash,
        validFrom,
        validUntil,
        paymentAsset,
        payTo,
        priceTinybar,
      );

    const stored = await policy.getPolicy(policyId);
    expect(stored.policyId).to.equal(policyId);
    expect(stored.fileId).to.equal(fileId);
    expect(stored.serviceId).to.equal(serviceId);
    expect(stored.owner).to.equal(creator.address);
    expect(stored.currentVersion).to.equal(1n);

    const version = await policy.getPolicyVersion(policyId, 1n);
    expect(version.policyId).to.equal(policyId);
    expect(version.fileId).to.equal(fileId);
    expect(version.serviceId).to.equal(serviceId);
    expect(version.owner).to.equal(creator.address);
    expect(version.version).to.equal(1n);
    expect(version.validFrom).to.equal(validFrom);
    expect(version.validUntil).to.equal(validUntil);
    expect(version.paymentAsset).to.equal(paymentAsset);
    expect(version.payTo).to.equal(payTo);
    expect(version.priceTinybar).to.equal(priceTinybar);
    expect(version.status).to.equal(0n);
    expect(version.policyHash).to.equal(expectedHash);
    expect(await policy.isPolicyValid(policyId, 1n)).to.equal(true);
  });

  it("rejects a zero FileRegistry address", async function () {
    const Policy402 = await ethers.getContractFactory("Policy402");
    await expect(Policy402.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Policy402, "InvalidFileRegistry");
  });

  it("rejects creation for a file that does not exist", async function () {
    const { policy, fileRegistry, creator, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();
    const missingFileId = ethers.id("missing-file");
    const missingServiceId = computeServiceIdFromDescriptor(`api://files/${missingFileId}`);

    await expect(
      policy
        .connect(creator)
        .createPolicy(missingFileId, missingServiceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(fileRegistry, "FileNotFound");
  });

  it("uses the canonical api://files/ descriptor for service identity", async function () {
    const { policy, fileId, descriptor, serviceId } = await deployPolicyFixture();
    expect(descriptor).to.equal(`api://files/${fileId}`);
    expect(await policy.computeServiceId(descriptor)).to.equal(serviceId);
    expect(await policy.computeFileServiceId(fileId)).to.equal(serviceId);
  });

  it("rejects a service ID that does not match the canonical file descriptor", async function () {
    const { policy, creator, fileId, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();
    const badServiceId = computeServiceIdFromDescriptor("api://files/bad-file-id");

    await expect(
      policy
        .connect(creator)
        .createPolicy(fileId, badServiceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "InvalidServiceId");
  });

  it("rejects zero file and service IDs", async function () {
    const { policy, creator, fileId, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();

    await expect(
      policy
        .connect(creator)
        .createPolicy(ethers.ZeroHash, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "InvalidFileId");
    await expect(
      policy
        .connect(creator)
        .createPolicy(fileId, ethers.ZeroHash, validFrom, validUntil, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "InvalidServiceId");
  });

  it("rejects a policy when the caller does not own the FileRegistry file", async function () {
    const { policy, fileRegistry, alice, fileId, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();

    await fileRegistry
      .connect(alice)
      .registerFile(
        "other-owner-key",
        "0.0.9999",
        1_000_000n,
        false,
        ethers.id("other-owner-content"),
        "other.txt",
        "text/plain",
      );

    await expect(
      policy.connect(alice).createPolicy(fileId, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "NotOwner");
  });

  it("rejects an invalid validity window", async function () {
    const { policy, createPolicy, validFrom } = await deployPolicyFixture();
    await expect(createPolicy(undefined, { validUntil: validFrom })).to.be.revertedWithCustomError(
      policy,
      "InvalidValidityWindow",
    );
  });

  it("rejects an empty payment asset", async function () {
    const { policy, createPolicy } = await deployPolicyFixture();
    await expect(createPolicy(undefined, { paymentAsset: "" })).to.be.revertedWithCustomError(
      policy,
      "InvalidPaymentAsset",
    );
  });

  it("rejects an empty payTo value", async function () {
    const { policy, createPolicy } = await deployPolicyFixture();
    await expect(createPolicy(undefined, { payTo: "" })).to.be.revertedWithCustomError(policy, "InvalidPayTo");
  });

  it("rejects a zero price", async function () {
    const { policy, createPolicy } = await deployPolicyFixture();
    await expect(createPolicy(undefined, { priceTinybar: 0n })).to.be.revertedWithCustomError(policy, "InvalidPrice");
  });

  it("rejects a second policy for the same file and matches the V1 hash tuple", async function () {
    const {
      policy,
      creator,
      fileId,
      serviceId,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
      createPolicy,
    } = await deployPolicyFixture();

    const policyId = computePolicyId(serviceId);
    await createPolicy();

    await expect(
      policy
        .connect(creator)
        .createPolicy(fileId, serviceId, validFrom + 60n, validUntil + 60n, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "PolicyAlreadyExists");

    const version = await policy.getPolicyVersion(policyId, 1n);
    expect(version.fileId).to.equal(fileId);
    const expected = computePolicyHash(
      policyId,
      serviceId,
      creator.address,
      1n,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
    );
    expect(version.policyHash).to.equal(expected);
    expect(
      await policy.computePolicyHash(
        policyId,
        serviceId,
        creator.address,
        1n,
        validFrom,
        validUntil,
        paymentAsset,
        payTo,
        priceTinybar,
      ),
    ).to.equal(expected);
  });

  it("creates independent policies for different registered files", async function () {
    const { policy, creator, fileId, registerFile, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();
    const secondFileId = await registerFile(creator, "object-key-2");
    const secondServiceId = computeServiceIdFromDescriptor(`api://files/${secondFileId}`);

    await policy
      .connect(creator)
      .createPolicy(
        fileId,
        computeServiceIdFromDescriptor(`api://files/${fileId}`),
        validFrom,
        validUntil,
        paymentAsset,
        payTo,
        priceTinybar,
      );
    await policy
      .connect(creator)
      .createPolicy(secondFileId, secondServiceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar);

    const firstPolicyId = computePolicyId(computeServiceIdFromDescriptor(`api://files/${fileId}`));
    const secondPolicyId = computePolicyId(secondServiceId);
    expect(firstPolicyId).not.to.equal(secondPolicyId);
    expect((await policy.getPolicy(firstPolicyId)).fileId).to.equal(fileId);
    expect((await policy.getPolicy(secondPolicyId)).fileId).to.equal(secondFileId);
  });

  it("computes the deterministic exact V1 hash tuple", async function () {
    const { policy, creator, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    const expected = computePolicyHash(
      policyId,
      serviceId,
      creator.address,
      1n,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
    );

    expect(await policy.computePolicyId(serviceId)).to.equal(policyId);
    expect(
      await policy.computePolicyHash(
        policyId,
        serviceId,
        creator.address,
        1n,
        validFrom,
        validUntil,
        paymentAsset,
        payTo,
        priceTinybar,
      ),
    ).to.equal(expected);
  });

  it("does not allow a second createPolicy for a file after its version is revoked", async function () {
    const {
      policy,
      creator,
      fileId,
      serviceId,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
      createPolicy,
    } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    await policy.connect(creator).revokePolicy(policyId, 1n);

    await expect(
      policy
        .connect(creator)
        .createPolicy(fileId, serviceId, validFrom + 1n, validUntil + 1n, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "PolicyAlreadyExists");
  });
  it("changes the hash when any substantive hashed field changes", async function () {
    const { policy, creator, alice, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar } =
      await deployPolicyFixture();
    const base = {
      policyId: computePolicyId(serviceId),
      serviceId,
      owner: creator.address,
      version: 1n,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
    };
    const hashFor = (values: typeof base) =>
      policy.computePolicyHash(
        values.policyId,
        values.serviceId,
        values.owner,
        values.version,
        values.validFrom,
        values.validUntil,
        values.paymentAsset,
        values.payTo,
        values.priceTinybar,
      );
    const baseHash = await hashFor(base);
    const variants: Array<Partial<typeof base>> = [
      { policyId: ethers.id("other-policy") },
      { serviceId: ethers.id("other-service") },
      { owner: alice.address },
      { version: 2n },
      { validFrom: validFrom + 1n },
      { validUntil: validUntil + 1n },
      { paymentAsset: "HBAR" },
      { payTo: "0.0.9999" },
      { priceTinybar: priceTinybar + 1n },
    ];

    for (const variant of variants) {
      expect(await hashFor({ ...base, ...variant })).not.to.equal(baseHash);
    }
  });

  it("keeps a version hash and terms unchanged when revocation changes its status", async function () {
    const { policy, creator, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar, createPolicy } =
      await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    const before = await policy.getPolicyVersion(policyId, 1n);

    await policy.connect(creator).revokePolicy(policyId, 1n);
    const after = await policy.getPolicyVersion(policyId, 1n);

    expect(after.status).to.equal(1n);
    expect(after.createdAt).to.equal(before.createdAt);
    expect(after.policyHash).to.equal(before.policyHash);
    expect(after.validFrom).to.equal(validFrom);
    expect(after.validUntil).to.equal(validUntil);
    expect(after.paymentAsset).to.equal(paymentAsset);
    expect(after.payTo).to.equal(payTo);
    expect(after.priceTinybar).to.equal(priceTinybar);
    expect(await policy.getPolicyHash(policyId, 1n)).to.equal(before.policyHash);
  });

  it("creates owner-only versions with increasing numbers and preserves prior versions", async function () {
    const {
      policy,
      creator,
      alice,
      fileId,
      serviceId,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
      createPolicy,
    } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    const original = await policy.getPolicyVersion(policyId, 1n);
    const secondTerms = {
      validFrom: validFrom + 10n,
      validUntil: validUntil + 10n,
      paymentAsset: "HBAR",
      payTo: "0.0.5678",
      priceTinybar: priceTinybar + 100n,
    };
    const secondHash = computePolicyHash(
      policyId,
      serviceId,
      creator.address,
      2n,
      secondTerms.validFrom,
      secondTerms.validUntil,
      secondTerms.paymentAsset,
      secondTerms.payTo,
      secondTerms.priceTinybar,
    );

    await expect(
      policy
        .connect(creator)
        .createVersion(
          policyId,
          secondTerms.validFrom,
          secondTerms.validUntil,
          secondTerms.paymentAsset,
          secondTerms.payTo,
          secondTerms.priceTinybar,
        ),
    )
      .to.emit(policy, "PolicyVersionCreated")
      .withArgs(
        policyId,
        fileId,
        serviceId,
        creator.address,
        2n,
        secondHash,
        secondTerms.validFrom,
        secondTerms.validUntil,
        secondTerms.paymentAsset,
        secondTerms.payTo,
        secondTerms.priceTinybar,
      );

    await policy
      .connect(creator)
      .createVersion(policyId, validFrom + 20n, validUntil + 20n, paymentAsset, payTo, priceTinybar);
    const second = await policy.getPolicyVersion(policyId, 2n);
    const third = await policy.getPolicyVersion(policyId, 3n);
    const state = await policy.getPolicy(policyId);

    expect(original.version).to.equal(1n);
    expect(original.status).to.equal(0n);
    expect(second.version).to.equal(2n);
    expect(second.fileId).to.equal(fileId);
    expect(second.status).to.equal(0n);
    expect(second.policyHash).to.equal(secondHash);
    expect(third.version).to.equal(3n);
    expect(state.currentVersion).to.equal(3n);
    expect(await policy.getPolicyVersionCount(policyId)).to.equal(3n);
    expect((await policy.getPolicyVersion(policyId, 1n)).policyHash).to.equal(original.policyHash);
    expect((await policy.getCurrentPolicy(serviceId)).currentVersion).to.equal(3n);

    await expect(
      policy.connect(alice).createVersion(policyId, validFrom, validUntil, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "NotOwner");
  });

  it("validates version terms using the same term errors", async function () {
    const { policy, creator, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar, createPolicy } =
      await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();

    await expect(
      policy.connect(creator).createVersion(policyId, validFrom, validFrom, paymentAsset, payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "InvalidValidityWindow");
    await expect(
      policy.connect(creator).createVersion(policyId, validFrom, validUntil, "", payTo, priceTinybar),
    ).to.be.revertedWithCustomError(policy, "InvalidPaymentAsset");
    await expect(
      policy.connect(creator).createVersion(policyId, validFrom, validUntil, paymentAsset, "", priceTinybar),
    ).to.be.revertedWithCustomError(policy, "InvalidPayTo");
    await expect(
      policy.connect(creator).createVersion(policyId, validFrom, validUntil, paymentAsset, payTo, 0n),
    ).to.be.revertedWithCustomError(policy, "InvalidPrice");
    expect(await policy.getPolicyVersionCount(policyId)).to.equal(1n);
  });

  it("returns the current active policy for its service ID", async function () {
    const { policy, serviceId, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();

    const current = await policy.getCurrentPolicy(serviceId);
    expect(current.policyId).to.equal(policyId);
    expect(current.currentVersion).to.equal(1n);
  });

  it("supports known lookups and rejects unknown policy or version lookups", async function () {
    const { policy, serviceId, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();

    expect((await policy.getPolicy(policyId)).policyId).to.equal(policyId);
    expect((await policy.getPolicyVersion(policyId, 1n)).version).to.equal(1n);
    expect(await policy.getPolicyVersionCount(policyId)).to.equal(1n);
    expect(await policy.getPolicyHash(policyId, 1n)).to.equal((await policy.getPolicyVersion(policyId, 1n)).policyHash);

    const unknownId = ethers.id("unknown-policy");
    await expect(policy.getPolicy(unknownId)).to.be.revertedWithCustomError(policy, "PolicyNotFound");
    await expect(policy.getPolicyVersion(unknownId, 1n)).to.be.revertedWithCustomError(policy, "PolicyVersionNotFound");
    await expect(policy.getPolicyVersion(policyId, 2n)).to.be.revertedWithCustomError(policy, "PolicyVersionNotFound");
    await expect(policy.getPolicyVersionCount(unknownId)).to.be.revertedWithCustomError(policy, "PolicyNotFound");
    await expect(policy.getPolicyHash(policyId, 2n)).to.be.revertedWithCustomError(policy, "PolicyVersionNotFound");
    await expect(policy.getCurrentPolicy(ethers.id("unknown-service"))).to.be.revertedWithCustomError(
      policy,
      "PolicyNotFound",
    );
    await expect(
      policy.connect((await ethers.getSigners())[1]).createVersion(unknownId, 1n, 2n, PAYMENT_ASSET, PAY_TO, 1n),
    ).to.be.revertedWithCustomError(policy, "PolicyNotFound");
  });

  it("uses inclusive lower and exclusive upper validity boundaries", async function () {
    const { policy, serviceId, validFrom, validUntil, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();

    expect(await policy.isPolicyValidAt(policyId, 1n, validFrom - 1n)).to.equal(false);
    expect(await policy.isPolicyValidAt(policyId, 1n, validFrom)).to.equal(true);
    expect(await policy.isPolicyValidAt(policyId, 1n, validUntil - 1n)).to.equal(true);
    expect(await policy.isPolicyValidAt(policyId, 1n, validUntil)).to.equal(false);
    expect(await policy.isPolicyValidAt(policyId, 1n, validUntil + 1n)).to.equal(false);
  });

  it("checks isPolicyValid against the current block timestamp", async function () {
    const { policy, serviceId, validUntil, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    expect(await policy.isPolicyValid(policyId, 1n)).to.equal(true);

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(validUntil)]);
    await ethers.provider.send("evm_mine", []);
    expect(await policy.isPolicyValid(policyId, 1n)).to.equal(false);
  });

  it("allows only the policy owner to revoke a version and emits the version-level event", async function () {
    const {
      policy,
      creator,
      alice,
      fileId,
      serviceId,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
      createPolicy,
    } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    const before = await policy.getPolicyVersion(policyId, 1n);

    await expect(policy.connect(alice).revokePolicy(policyId, 1n)).to.be.revertedWithCustomError(policy, "NotOwner");
    await expect(policy.connect(creator).revokePolicy(policyId, 1n))
      .to.emit(policy, "PolicyRevoked")
      .withArgs(policyId, fileId, serviceId, creator.address, 1n, before.policyHash);

    const revoked = await policy.getPolicyVersion(policyId, 1n);
    expect(revoked.status).to.equal(1n);
    expect(revoked.fileId).to.equal(fileId);
    expect(revoked.validFrom).to.equal(validFrom);
    expect(revoked.validUntil).to.equal(validUntil);
    expect(revoked.paymentAsset).to.equal(paymentAsset);
    expect(revoked.payTo).to.equal(payTo);
    expect(revoked.priceTinybar).to.equal(priceTinybar);
    expect(revoked.policyHash).to.equal(before.policyHash);
    expect(await policy.getPolicyHash(policyId, 1n)).to.equal(before.policyHash);
    expect(await policy.isPolicyValidAt(policyId, 1n, validFrom)).to.equal(false);
  });

  it("rejects revoking an already revoked version", async function () {
    const { policy, creator, serviceId, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    await policy.connect(creator).revokePolicy(policyId, 1n);

    await expect(policy.connect(creator).revokePolicy(policyId, 1n)).to.be.revertedWithCustomError(
      policy,
      "PolicyAlreadyRevoked",
    );
  });

  it("rejects revoking a version that does not exist", async function () {
    const { policy, creator, serviceId, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();

    await expect(policy.connect(creator).revokePolicy(policyId, 2n)).to.be.revertedWithCustomError(
      policy,
      "PolicyVersionNotFound",
    );
  });

  it("keeps a newer current version available when an older version is revoked", async function () {
    const { policy, creator, serviceId, validFrom, validUntil, paymentAsset, payTo, priceTinybar, createPolicy } =
      await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    await policy
      .connect(creator)
      .createVersion(policyId, validFrom + 1n, validUntil + 1n, paymentAsset, payTo, priceTinybar);
    await policy.connect(creator).revokePolicy(policyId, 1n);

    expect((await policy.getPolicyVersion(policyId, 1n)).status).to.equal(1n);
    expect((await policy.getPolicyVersion(policyId, 2n)).status).to.equal(0n);
    expect((await policy.getPolicy(policyId)).currentVersion).to.equal(2n);
    expect((await policy.getCurrentPolicy(serviceId)).currentVersion).to.equal(2n);
    expect(await policy.isPolicyValidAt(policyId, 2n, validFrom + 2n)).to.equal(true);
  });

  it("makes getCurrentPolicy fail when its current version is revoked", async function () {
    const { policy, creator, serviceId, createPolicy } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    await policy.connect(creator).revokePolicy(policyId, 1n);

    await expect(policy.getCurrentPolicy(serviceId)).to.be.revertedWithCustomError(policy, "PolicyNotFound");
    expect((await policy.getPolicy(policyId)).currentVersion).to.equal(1n);
    expect(await policy.getPolicyVersionCount(policyId)).to.equal(1n);
  });

  it("allows a new active version after revoking version 1", async function () {
    const {
      policy,
      creator,
      fileId,
      serviceId,
      validFrom,
      validUntil,
      paymentAsset,
      payTo,
      priceTinybar,
      createPolicy,
    } = await deployPolicyFixture();
    const policyId = computePolicyId(serviceId);
    await createPolicy();
    await policy.connect(creator).revokePolicy(policyId, 1n);

    const version2Hash = computePolicyHash(
      policyId,
      serviceId,
      creator.address,
      2n,
      validFrom + 1n,
      validUntil + 1n,
      paymentAsset,
      payTo,
      priceTinybar,
    );
    await expect(
      policy
        .connect(creator)
        .createVersion(policyId, validFrom + 1n, validUntil + 1n, paymentAsset, payTo, priceTinybar),
    )
      .to.emit(policy, "PolicyVersionCreated")
      .withArgs(
        policyId,
        fileId,
        serviceId,
        creator.address,
        2n,
        version2Hash,
        validFrom + 1n,
        validUntil + 1n,
        paymentAsset,
        payTo,
        priceTinybar,
      );

    const state = await policy.getPolicy(policyId);
    const version1 = await policy.getPolicyVersion(policyId, 1n);
    const version2 = await policy.getPolicyVersion(policyId, 2n);
    expect(version1.status).to.equal(1n);
    expect(version2.status).to.equal(0n);
    expect(version2.fileId).to.equal(fileId);
    expect(version2.policyHash).to.equal(version2Hash);
    expect(state.currentVersion).to.equal(2n);
    expect(await policy.getPolicyVersionCount(policyId)).to.equal(2n);
    expect((await policy.getCurrentPolicy(serviceId)).currentVersion).to.equal(2n);
    expect(await policy.isPolicyValidAt(policyId, 1n, validFrom + 2n)).to.equal(false);
    expect(await policy.isPolicyValidAt(policyId, 2n, validFrom + 2n)).to.equal(true);
  });
});
