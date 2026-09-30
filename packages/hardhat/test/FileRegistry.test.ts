import { expect } from "chai";
import { ethers } from "hardhat";
import type { FileRegistry } from "../typechain-types";

describe("FileRegistry", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();
    const FileRegistry = await ethers.getContractFactory("FileRegistry");
    const registry = await FileRegistry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, alice, bob };
  }

  const sample = {
    objectKey: "uploads/2026/report.pdf",
    payToAccountId: "0.0.1234",
    priceTinybar: 1_000_000_000n, // 10 HBAR
    isPublic: false,
    contentHash: ethers.id("the file contents"),
    name: "Quarterly Report",
    mimeType: "application/pdf",
  };

  async function register(registry: FileRegistry, overrides: Partial<typeof sample> = {}) {
    const f = { ...sample, ...overrides };
    return registry.registerFile(
      f.objectKey,
      f.payToAccountId,
      f.priceTinybar,
      f.isPublic,
      f.contentHash,
      f.name,
      f.mimeType,
    );
  }

  describe("Deployment", function () {
    it("starts with no files", async function () {
      const { registry } = await deployFixture();
      expect(await registry.getFileCount()).to.equal(0n);
    });

    it("exposes the HBAR payment asset id", async function () {
      const { registry } = await deployFixture();
      expect(await registry.PAYMENT_ASSET()).to.equal("0.0.0");
    });
  });

  describe("registerFile", function () {
    it("registers a file and emits FileRegistered", async function () {
      const { registry, owner } = await deployFixture();
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);

      await expect(register(registry))
        .to.emit(registry, "FileRegistered")
        .withArgs(
          fileId,
          owner.address,
          sample.objectKey,
          sample.payToAccountId,
          sample.priceTinybar,
          sample.isPublic,
          sample.contentHash,
          sample.name,
          sample.mimeType,
        );

      expect(await registry.getFileCount()).to.equal(1n);
    });

    it("stores the file metadata", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);

      const file = await registry.getFile(fileId);
      expect(file.owner).to.equal(owner.address);
      expect(file.payToAccountId).to.equal(sample.payToAccountId);
      expect(file.priceTinybar).to.equal(sample.priceTinybar);
      expect(file.isPublic).to.equal(sample.isPublic);
      expect(file.objectKey).to.equal(sample.objectKey);
      expect(file.contentHash).to.equal(sample.contentHash);
      expect(file.name).to.equal(sample.name);
      expect(file.mimeType).to.equal(sample.mimeType);
      expect(file.exists).to.equal(true);
    });

    it("computes a deterministic file id per (owner, objectKey)", async function () {
      const { registry, owner, alice } = await deployFixture();
      const id1 = await registry.computeFileId(owner.address, sample.objectKey);
      const id1Again = await registry.computeFileId(owner.address, sample.objectKey);
      const idAlice = await registry.computeFileId(alice.address, sample.objectKey);
      expect(id1).to.equal(id1Again);
      expect(id1).to.not.equal(idAlice);
    });

    it("lets different owners register the same object key", async function () {
      const { registry, alice } = await deployFixture();
      await register(registry);
      await register(registry.connect(alice));
      expect(await registry.getFileCount()).to.equal(2n);
    });

    it("reverts when the object key is empty", async function () {
      const { registry } = await deployFixture();
      await expect(register(registry, { objectKey: "" }))
        .to.be.revertedWithCustomError(registry, "EmptyValue")
        .withArgs("objectKey");
    });

    it("reverts when the payTo account id is empty", async function () {
      const { registry } = await deployFixture();
      await expect(register(registry, { payToAccountId: "" }))
        .to.be.revertedWithCustomError(registry, "EmptyValue")
        .withArgs("payToAccountId");
    });

    it("reverts when the content hash is zero", async function () {
      const { registry } = await deployFixture();
      await expect(register(registry, { contentHash: ethers.ZeroHash })).to.be.revertedWithCustomError(
        registry,
        "InvalidContentHash",
      );
    });

    it("reverts when the mime type is empty", async function () {
      const { registry } = await deployFixture();
      await expect(register(registry, { mimeType: "" }))
        .to.be.revertedWithCustomError(registry, "EmptyValue")
        .withArgs("mimeType");
    });

    it("reverts when the same owner registers the same object key twice", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await expect(register(registry))
        .to.be.revertedWithCustomError(registry, "FileAlreadyRegistered")
        .withArgs(fileId);
    });
  });

  describe("setPrice", function () {
    it("updates the price and emits PriceChanged", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      const newPrice = 5_000_000_000n;

      await expect(registry.setPrice(fileId, newPrice))
        .to.emit(registry, "PriceChanged")
        .withArgs(fileId, sample.priceTinybar, newPrice);

      expect((await registry.getFile(fileId)).priceTinybar).to.equal(newPrice);
    });

    it("reverts for a non-owner", async function () {
      const { registry, owner, alice } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await expect(registry.connect(alice).setPrice(fileId, 1n))
        .to.be.revertedWithCustomError(registry, "NotFileOwner")
        .withArgs(fileId, alice.address);
    });

    it("reverts for an unknown file", async function () {
      const { registry } = await deployFixture();
      const fileId = ethers.id("missing");
      await expect(registry.setPrice(fileId, 1n))
        .to.be.revertedWithCustomError(registry, "FileNotFound")
        .withArgs(fileId);
    });
  });

  describe("setVisibility", function () {
    it("toggles visibility and emits VisibilityChanged", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry, { isPublic: false });
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);

      await expect(registry.setVisibility(fileId, true)).to.emit(registry, "VisibilityChanged").withArgs(fileId, true);
      expect((await registry.getFile(fileId)).isPublic).to.equal(true);
    });

    it("reverts for a non-owner", async function () {
      const { registry, owner, bob } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await expect(registry.connect(bob).setVisibility(fileId, true))
        .to.be.revertedWithCustomError(registry, "NotFileOwner")
        .withArgs(fileId, bob.address);
    });
  });

  describe("setPayToAccountId", function () {
    it("updates the payout account and emits PayToChanged", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);

      await expect(registry.setPayToAccountId(fileId, "0.0.9999"))
        .to.emit(registry, "PayToChanged")
        .withArgs(fileId, sample.payToAccountId, "0.0.9999");
      expect((await registry.getFile(fileId)).payToAccountId).to.equal("0.0.9999");
    });

    it("reverts when the new payTo is empty", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await expect(registry.setPayToAccountId(fileId, ""))
        .to.be.revertedWithCustomError(registry, "EmptyValue")
        .withArgs("payToAccountId");
    });

    it("reverts for a non-owner", async function () {
      const { registry, owner, alice } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await expect(registry.connect(alice).setPayToAccountId(fileId, "0.0.1")).to.be.revertedWithCustomError(
        registry,
        "NotFileOwner",
      );
    });
  });

  describe("getFile", function () {
    it("reverts for an unknown file", async function () {
      const { registry } = await deployFixture();
      const fileId = ethers.id("missing");
      await expect(registry.getFile(fileId)).to.be.revertedWithCustomError(registry, "FileNotFound").withArgs(fileId);
    });
  });

  describe("delistFile", function () {
    it("delists a file, emits FileDelisted, and removes it from the marketplace", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);

      await expect(registry.delistFile(fileId)).to.emit(registry, "FileDelisted").withArgs(fileId, owner.address);

      expect(await registry.getFileCount()).to.equal(0n);
      await expect(registry.getFile(fileId)).to.be.revertedWithCustomError(registry, "FileNotFound").withArgs(fileId);

      const [ids] = await registry.getFiles(0, 10);
      expect(ids.length).to.equal(0);
    });

    it("excludes a delisted file from paginated listings", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry, { objectKey: "uploads/a.bin", name: "A" });
      await register(registry, { objectKey: "uploads/b.bin", name: "B" });
      await register(registry, { objectKey: "uploads/c.bin", name: "C" });
      const fileIdB = await registry.computeFileId(owner.address, "uploads/b.bin");

      await registry.delistFile(fileIdB);
      expect(await registry.getFileCount()).to.equal(2n);

      const [, files] = await registry.getFiles(0, 10);
      expect(files.map(f => f.name)).to.deep.equal(["A", "C"]);
    });

    it("lets the owner re-register the same object key after delisting", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await registry.delistFile(fileId);

      await expect(register(registry, { name: "Re-listed" })).to.emit(registry, "FileRegistered");
      expect(await registry.getFileCount()).to.equal(1n);
      expect((await registry.getFile(fileId)).name).to.equal("Re-listed");
    });

    it("reverts for a non-owner", async function () {
      const { registry, owner, alice } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await expect(registry.connect(alice).delistFile(fileId))
        .to.be.revertedWithCustomError(registry, "NotFileOwner")
        .withArgs(fileId, alice.address);
    });

    it("reverts when delisting twice", async function () {
      const { registry, owner } = await deployFixture();
      await register(registry);
      const fileId = await registry.computeFileId(owner.address, sample.objectKey);
      await registry.delistFile(fileId);
      await expect(registry.delistFile(fileId))
        .to.be.revertedWithCustomError(registry, "FileNotFound")
        .withArgs(fileId);
    });
  });

  describe("getFiles pagination", function () {
    async function withThreeFiles() {
      const ctx = await deployFixture();
      for (let i = 0; i < 3; i++) {
        await register(ctx.registry, { objectKey: `uploads/file-${i}.bin`, name: `File ${i}` });
      }
      return ctx;
    }

    it("returns a bounded page", async function () {
      const { registry } = await withThreeFiles();
      const [ids, files] = await registry.getFiles(0, 2);
      expect(ids.length).to.equal(2);
      expect(files.length).to.equal(2);
      expect(files[0].name).to.equal("File 0");
      expect(files[1].name).to.equal("File 1");
    });

    it("clamps the page to the number of remaining files", async function () {
      const { registry } = await withThreeFiles();
      const [ids, files] = await registry.getFiles(2, 10);
      expect(ids.length).to.equal(1);
      expect(files[0].name).to.equal("File 2");
    });

    it("returns empty arrays when the offset is past the end", async function () {
      const { registry } = await withThreeFiles();
      const [ids, files] = await registry.getFiles(5, 2);
      expect(ids.length).to.equal(0);
      expect(files.length).to.equal(0);
    });

    it("returns empty arrays when the limit is zero", async function () {
      const { registry } = await withThreeFiles();
      const [ids] = await registry.getFiles(0, 0);
      expect(ids.length).to.equal(0);
    });

    it("clamps the page size to MAX_PAGE_SIZE", async function () {
      const { registry } = await deployFixture();
      const maxPage = await registry.MAX_PAGE_SIZE();
      const fileCount = Number(maxPage) + 2;

      for (let i = 0; i < fileCount; i++) {
        await register(registry, { objectKey: `uploads/cap-${i}.bin`, name: `Cap ${i}` });
      }

      const [ids] = await registry.getFiles(0, fileCount);
      expect(ids.length).to.equal(Number(maxPage));
    });
  });
});
