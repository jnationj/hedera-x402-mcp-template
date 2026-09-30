/**
 * HBAR / tinybar helpers for the x402 pay-per-use template.
 *
 * Prices live on-chain in **tinybars** (1 HBAR = 1e8 tinybars), matching x402's
 * atomic-unit convention for native HBAR. The UI shows HBAR, so these helpers
 * convert between the two without floating-point drift.
 */

/** Tinybars in one HBAR. */
export const TINYBAR_PER_HBAR = 100_000_000n;

/**
 * Format a tinybar amount as a human-readable HBAR string (trailing zeros trimmed).
 *
 * @param tinybar - Amount in tinybars (bigint or decimal string).
 * @returns The amount in HBAR, e.g. `"1.5"` or `"0.001"`.
 */
export function formatTinybar(tinybar: bigint | string): string {
  const value = typeof tinybar === "bigint" ? tinybar : BigInt(tinybar);
  const whole = value / TINYBAR_PER_HBAR;
  const fraction = value % TINYBAR_PER_HBAR;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}

/**
 * Parse a user-entered HBAR string into tinybars.
 *
 * @param hbar - HBAR amount as a string (e.g. `"1.5"`). Empty/invalid -> `0n`.
 * @returns The amount in tinybars.
 * @throws When more than 8 decimal places are supplied (sub-tinybar precision).
 */
export function hbarToTinybar(hbar: string): bigint {
  const trimmed = hbar.trim();
  if (!trimmed) return 0n;
  if (!/^\d*\.?\d*$/.test(trimmed)) throw new Error("Invalid HBAR amount");

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > 8) throw new Error("HBAR supports at most 8 decimal places");

  const paddedFraction = fraction.padEnd(8, "0");
  return BigInt(whole || "0") * TINYBAR_PER_HBAR + BigInt(paddedFraction || "0");
}
