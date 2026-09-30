/** Stub for optional wagmi MetaMask SDK dependency (HashPack-only app). */
export function createEVMClient() {
  throw new Error("MetaMask is not supported in this app. Connect with HashPack.");
}
