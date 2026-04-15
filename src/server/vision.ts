import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

/** Default must be a model your Anthropic key can access (3.5 Sonnet 20241022 was retired). */
const CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

type VisionProvider = "auto" | "openai" | "claude";

function resolvedProvider(): VisionProvider {
  const p = (process.env.VISION_PROVIDER || "auto").toLowerCase();
  if (p === "openai" || p === "claude") return p;
  return "auto";
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(body) as Record<string, unknown>;
}

async function visionWithOpenAI(
  buf: Buffer,
  mime: string,
  systemText: string,
  userText: string
): Promise<Record<string, unknown>> {
  if (!openai) throw new Error("OPENAI_API_KEY not set");
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemText },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("empty_model");
  return extractJsonObject(raw);
}

async function visionWithClaude(
  buf: Buffer,
  mime: string,
  systemText: string,
  userText: string
): Promise<Record<string, unknown>> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY not set");
  const mediaType =
    mime === "image/png" || mime === "image/gif" || mime === "image/webp"
      ? mime
      : "image/jpeg";
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: systemText,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: buf.toString("base64"),
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("empty_model");
  return extractJsonObject(block.text);
}

export type VisionUnconfigured = { ok: false; message: string };
export type VisionOk = { ok: true; json: Record<string, unknown> };
export type VisionResult = VisionOk | VisionUnconfigured;

/** Text-only JSON extraction (stage matching, etc.). */
export async function runClaudeTextJson(
  systemText: string,
  userPrompt: string
): Promise<VisionResult> {
  if (!anthropic) {
    return {
      ok: false,
      message: "Set ANTHROPIC_API_KEY on the server for text matching.",
    };
  }
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemText,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return { ok: false, message: "empty_model" };
    }
    return { ok: true, json: extractJsonObject(block.text) };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, message: raw };
  }
}

export async function runVisionJson(
  buf: Buffer,
  mime: string,
  schemaHint: string,
  userPrompt: string
): Promise<VisionResult> {
  const systemText = `You read festival flyers and timetables. Reply with valid JSON only (no markdown fences). ${schemaHint}`;

  const mode = resolvedProvider();

  const tryClaude = async () =>
    visionWithClaude(buf, mime, systemText, userPrompt);
  const tryOpenAI = async () =>
    visionWithOpenAI(buf, mime, systemText, userPrompt);

  try {
    if (mode === "claude") {
      if (!anthropic) {
        return {
          ok: false,
          message:
            "Set ANTHROPIC_API_KEY on the server (VISION_PROVIDER=claude).",
        };
      }
      return { ok: true, json: await tryClaude() };
    }
    if (mode === "openai") {
      if (!openai) {
        return {
          ok: false,
          message: "Set OPENAI_API_KEY on the server (VISION_PROVIDER=openai).",
        };
      }
      return { ok: true, json: await tryOpenAI() };
    }
    if (anthropic) {
      try {
        return { ok: true, json: await tryClaude() };
      } catch (first) {
        if (openai) {
          return { ok: true, json: await tryOpenAI() };
        }
        throw first;
      }
    }
    if (openai) {
      return { ok: true, json: await tryOpenAI() };
    }
    return {
      ok: false,
      message:
        "Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY on the server. With both set, Claude is tried first (VISION_PROVIDER=openai to skip Claude).",
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (raw === "empty_model") {
      return {
        ok: false,
        message:
          "The vision model returned no usable output for this image. Try a sharper photo, better lighting, or a crop that shows the lineup or timetable clearly.",
      };
    }
    if (
      raw.includes("not_found_error") ||
      raw.includes("not_found") && raw.includes("model")
    ) {
      return {
        ok: false,
        message: `Claude model is unavailable or not allowed for this API key (configured: ${CLAUDE_MODEL}). Set ANTHROPIC_MODEL in Vercel to a current vision-capable id (e.g. claude-sonnet-4-6) and redeploy. Details: ${raw.slice(0, 400)}`,
      };
    }
    return { ok: false, message: raw };
  }
}
