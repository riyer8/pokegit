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
  const result = await openaiChatMessages({
    temperature,
    maxTokens,
    json: true,
    messages: [
      { role: "system", content: String(system || "") },
      { role: "user", content: String(user || "") },
    ],
  });
  if (!result.ok) return result;
  return { ok: true, content: result.content };
}

export async function openaiChatMessages({
  messages = [],
  temperature = 0.4,
  maxTokens = 700,
  json = false,
} = {}) {
  const key = await getOpenAIKey();
  if (!key) return { ok: false, missingKey: true };

  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "system" || m.role === "user" || m.role === "assistant"))
    .slice(0, 24)
    .map((m) => ({
      role: m.role,
      content: redactSecrets(String(m.content || "")).slice(0, 24000),
    }));
  if (!safeMessages.length) return { ok: false, error: "Empty chat" };

  try {
    const body = {
      model: "gpt-4o-mini",
      temperature,
      max_tokens: maxTokens,
      messages: safeMessages,
    };
    if (json) body.response_format = { type: "json_object" };

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return {
      ok: true,
      content: redactSecrets(typeof content === "string" ? content : ""),
    };
  } catch (err) {
    return { ok: false, error: redactSecrets(err?.message || "openai failed") };
  }
}

export async function openaiChatStream({
  messages = [],
  temperature = 0.4,
  maxTokens = 700,
  onDelta,
} = {}) {
  const key = await getOpenAIKey();
  if (!key) return { ok: false, missingKey: true };

  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "system" || m.role === "user" || m.role === "assistant"))
    .slice(0, 24)
    .map((m) => ({
      role: m.role,
      content: redactSecrets(String(m.content || "")).slice(0, 24000),
    }));
  if (!safeMessages.length) return { ok: false, error: "Empty chat" };

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
        stream: true,
        messages: safeMessages,
      }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    if (!res.body) return openaiChatMessages({ messages, temperature, maxTokens });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const piece = json?.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece) {
            full += piece;
            const safe = redactSecrets(full);
            if (typeof onDelta === "function") onDelta(safe);
          }
        } catch {
          /* ignore a partial SSE frame */
        }
      }
    }

    const content = redactSecrets(full);
    if (!content) return { ok: false, error: "Empty stream" };
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: redactSecrets(err?.message || "openai failed") };
  }
}
