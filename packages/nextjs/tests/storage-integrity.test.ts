import { compareContentHashes } from "../services/storage/client";
import assert from "node:assert/strict";
import test from "node:test";

test("matching hash is verified", () => {
  const digest = "0x4f5e7b7f6a2fef7d6e4d2070e0f2bb3d0a4d4a8ee2b5d4aa3ad7cc7a92f2d7c7";
  const result = compareContentHashes(digest, digest);

  assert.equal(result.verified, true);
  assert.equal(result.status, "verified");
  assert.equal(result.expectedHash, digest);
  assert.equal(result.actualHash, digest);
});

test("different hash is treated as a mismatch", () => {
  const expected = "0x4f5e7b7f6a2fef7d6e4d2070e0f2bb3d0a4d4a8ee2b5d4aa3ad7cc7a92f2d7c7";
  const actual = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const result = compareContentHashes(expected, actual);

  assert.equal(result.verified, false);
  assert.equal(result.status, "mismatch");
  assert.equal(result.expectedHash, expected);
  assert.equal(result.actualHash, actual);
});
