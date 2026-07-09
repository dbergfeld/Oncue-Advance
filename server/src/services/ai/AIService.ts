import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export class AIServiceNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set. Add it to server/.env to enable live AI analysis.");
    this.name = "AIServiceNotConfiguredError";
  }
}

export class AIServiceParseError extends Error {
  constructor(public raw: string) {
    super("AI service response was not valid JSON matching the expected schema.");
    this.name = "AIServiceParseError";
  }
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AIServiceNotConfiguredError();
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/** True when a live call is possible — routes use this to fail fast with a clear error instead of a 500. */
export function isAIServiceConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

interface StructuredCallParams {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * Base call used by every AI service in this directory: sends a system
 * prompt + user prompt, requires the model to respond with ONLY a JSON
 * object, and parses it. Every service layers its own Zod-validated shape
 * on top of this — see RiskEngine.ts for the pattern.
 */
export async function callStructured({ system, prompt, maxTokens = 2048 }: StructuredCallParams): Promise<unknown> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new AIServiceParseError(raw);

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new AIServiceParseError(raw);
  }
}
