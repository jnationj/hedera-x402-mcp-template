import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "~~/services/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Handle a Streamable HTTP request with a fresh stateless server and transport. */
async function handleMcpRequest(request: Request): Promise<Response> {
  try {
    const server = await createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("[api/mcp] request setup failed", error instanceof Error ? error.name : "unknown error");
    return Response.json({ error: "MCP service unavailable" }, { status: 503 });
  }
}

/** Handle MCP initialization and tool calls over stateless Streamable HTTP. */
export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

/** Handle the optional standalone SSE stream opened by StreamableHTTPClientTransport. */
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
