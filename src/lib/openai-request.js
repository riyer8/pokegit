/**
 * The only module allowed to attach an OpenAI Authorization header.
 * Callers never receive the raw key.
 */

import { getOpenAIKey } from "./secrets.js";
import { redactSecrets } from "./secret-safety.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export async function openaiChatJson({
  system,
  user,
  temperature = 0.5,
  maxTokens = 700,
} = {}) {
  const key = await getOpenAIKey();
  if (!key) return { ok: false, missingKey: true };

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: String(system || "") },
          { role: "user", content: String(user || "") },
        ],
      }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return { ok: true, content: typeof content === "string" ? content : "" };
  } catch (err) {
    return { ok: false, error: redactSecrets(err?.message || "openai failed") };
  }
}
