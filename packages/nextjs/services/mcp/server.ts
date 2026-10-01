import { getServiceInfo, getServiceInfoInputSchema, getServiceInfoOutputSchema } from "./tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPaymentWrapper } from "@x402/mcp";
import { HBAR_ASSET, MAX_TIMEOUT_SECONDS, X402_NETWORK, getResourceServer } from "~~/services/x402/server";

const MCP_NETWORK = "hedera:testnet";
const SERVICE_NAME = "Hedera Pay-Per-Use MCP Demo";
const SERVICE_DESCRIPTION = "A fixed-price Hedera HBAR payment demo for MCP tool calls.";

function getPayToAccountId(): string {
  const accountId = process.env.X402_MCP_PAY_TO?.trim();
  if (!accountId) {
    throw new Error("X402_MCP_PAY_TO is required for the paid MCP tool");
  }
  if (!/^\d+\.\d+\.\d+$/.test(accountId)) {
    throw new Error("X402_MCP_PAY_TO must be a concrete Hedera account ID");
  }
  return accountId;
}

/** Build the stateless MCP server and its single paid demo tool. */
export async function createMcpServer(): Promise<McpServer> {
  if (X402_NETWORK !== MCP_NETWORK) {
    throw new Error(`The paid MCP demo requires X402_NETWORK=${MCP_NETWORK}`);
  }

  const payTo = getPayToAccountId();
  const resourceServer = await getResourceServer();
  const accepts = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network: MCP_NETWORK,
    payTo,
    price: { asset: HBAR_ASSET, amount: "1000000" },
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  });

  const paid = createPaymentWrapper(resourceServer, {
    accepts,
    resource: {
      url: "mcp://tool/get_service_info",
      description: SERVICE_DESCRIPTION,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
    },
  });

  const server = new McpServer({ name: SERVICE_NAME, version: "0.1.0" });
  server.registerTool(
    "get_service_info",
    {
      title: "Get service information",
      description: "Returns deterministic information about the Hedera paid MCP demo.",
      inputSchema: getServiceInfoInputSchema,
      outputSchema: getServiceInfoOutputSchema,
    },
    paid(getServiceInfo),
  );

  return server;
}
