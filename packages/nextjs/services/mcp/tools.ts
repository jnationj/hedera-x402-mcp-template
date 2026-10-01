import { z } from "zod";

export const getServiceInfoInputSchema = {
  topic: z.string().trim().min(1, "topic must not be empty"),
};

export const getServiceInfoOutputSchema = {
  service: z.literal("Hedera Pay-Per-Use MCP Demo"),
  topic: z.string(),
  message: z.literal("This response was delivered through a paid MCP tool on Hedera."),
};

type GetServiceInfoArgs = {
  topic: string;
};

/** Return deterministic service information for the paid demo tool. */
export function getServiceInfo({ topic }: GetServiceInfoArgs) {
  const result = {
    service: "Hedera Pay-Per-Use MCP Demo" as const,
    topic,
    message: "This response was delivered through a paid MCP tool on Hedera." as const,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
