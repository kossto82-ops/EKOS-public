/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { isMaskedKey, loadStoredProviderConfig, resolveStoredApiKey } from "./providerConfig.ts";
import { logger } from "./logger.ts";
import { normalizeUsage, recordLlmCall } from "./metrics.ts";

const tracer = trace.getTracer("ekos.ai");

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Shared Multi-Provider AI Routing Logic
 * Supports Google Gemini, Anthropic Claude, OpenAI, and custom OpenAI-compatible endpoints.
 */
export async function callAI(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  aiConfig: any
): Promise<string> {
  let mergedConfig = { ...aiConfig };

  // SECURITY: whether the CALLER supplied the endpoint in this request. The
  // server-stored/env API key must NEVER be sent to a caller-controlled URL —
  // otherwise a request like {provider:'openai', apiKey:'', customEndpointUrl:
  // 'http://attacker'} would make us decrypt the stored provider key and POST
  // it (as a Bearer token) to the attacker's host (SSRF + credential theft).
  // So we only resolve the stored/env key when the endpoint is NOT caller-set.
  const callerSuppliedEndpoint = typeof aiConfig?.customEndpointUrl === "string" && aiConfig.customEndpointUrl.trim() !== "";

  // If API key is empty, missing, or masked, load it securely from the database
  if (!mergedConfig.apiKey || mergedConfig.apiKey.trim() === "" || isMaskedKey(mergedConfig.apiKey)) {
    try {
      // NOTE: do not log the parsed config — it contains the provider apiKey.
      const parsed = loadStoredProviderConfig("ai_provider_config");
      if (parsed) {
        if (!callerSuppliedEndpoint && parsed?.apiKey && !isMaskedKey(parsed.apiKey)) {
          // Fails closed to "" on a decryption error — see providerConfig.ts.
          mergedConfig.apiKey = resolveStoredApiKey(parsed.apiKey);
        }
        if (parsed?.customEndpointUrl && !mergedConfig.customEndpointUrl) {
          mergedConfig.customEndpointUrl = parsed.customEndpointUrl;
        }
        // Backfill provider/model/temperature from the stored config when the
        // caller didn't specify them. Without this, a request that omits the
        // provider silently defaults to "gemini" below while using whatever
        // apiKey was loaded here (e.g. a Groq key) — producing a misleading
        // "[gemini] API key not valid" error.
        if (!mergedConfig.provider && parsed?.provider) {
          mergedConfig.provider = parsed.provider;
        }
        if (!mergedConfig.model && parsed?.model) {
          mergedConfig.model = parsed.model;
        }
        if (mergedConfig.temperature === undefined && parsed?.temperature !== undefined) {
          mergedConfig.temperature = parsed.temperature;
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to load secure API key from database inside callAI");
    }
  }

  // If the resolved key still includes mask characters, discard it to force environment variable fallback
  if (isMaskedKey(mergedConfig.apiKey)) {
    mergedConfig.apiKey = "";
  }

  const provider = mergedConfig?.provider || "gemini";
  const modelName = mergedConfig?.model || (provider === "gemini" ? "gemini-2.5-flash" : provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gpt-4o");
  const temperature = mergedConfig?.temperature !== undefined ? Number(mergedConfig.temperature) : 0.2;

  /**
   * One span and one metric sample per provider call, wrapping every branch.
   *
   * The HTTP instrumentation already sees the outbound request for the four
   * providers that use `fetch`, but not for Gemini (which goes through the
   * @google/genai client) and, more importantly, an HTTP span cannot say which
   * *model* was called or what it cost — the two attributes anyone asking about AI
   * spend or latency actually wants. Hence a domain span here rather than relying
   * on transport-level instrumentation alone.
   *
   * Attribute names follow the `gen_ai.*` semantic convention so a backend's
   * built-in LLM dashboards work without remapping. Neither the prompt nor the
   * response is recorded: this data leaves the network.
   */
  const span = tracer.startSpan("ai.generate", {
    attributes: {
      "gen_ai.system": provider,
      "gen_ai.request.model": modelName,
      "gen_ai.request.temperature": temperature,
    },
  });
  const startedAt = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;

  try {
    // The inner closure exists so each branch can hand back the raw provider
    // payload alongside the text. Before, every branch dug the text out and
    // discarded the response — including the `usage` block — which is why token
    // spend was not merely unmonitored but unavailable to monitor.
    const { text, raw } = await (async (): Promise<{ text: string; raw: any }> => {
    switch (provider) {
      case "gemini": {
        const apiKey = mergedConfig?.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey.trim() === "") {
          throw new Error("Missing Gemini API Key. Register it in Settings → AI Provider.");
        }
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });

        const contents = messages.map(msg => ({
          role: (msg.role === "assistant" || msg.role === "model" ? "model" : "user") as "model" | "user",
          parts: [{ text: msg.content }]
        }));

        const response = await withTimeout(
          ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              systemInstruction: systemPrompt,
              temperature,
            },
          }),
          30000,
          "Gemini request"
        );

        return { text: response.text || "", raw: response };
      }

      case "anthropic": {
        const apiKey = mergedConfig?.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey || apiKey.trim() === "") {
          throw new Error("Missing Anthropic API Key.");
        }

        const anthropicMessages = messages.map(msg => ({
          role: msg.role === "assistant" || msg.role === "model" ? "assistant" as const : "user" as const,
          content: msg.content
        }));

        const res = await withTimeout(
          fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: modelName,
              system: systemPrompt,
              messages: anthropicMessages,
              max_tokens: 1024,
              temperature
            })
          }),
          30000,
          "Anthropic request"
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Anthropic endpoint error: ${errText}`);
        }

        const data: any = await res.json();
        return { text: data.content?.[0]?.text || "", raw: data };
      }

      case "openai": {
        // Don't fall back to the env key when the caller supplied the endpoint —
        // that would leak OPENAI_API_KEY to a caller-controlled host.
        const apiKey = mergedConfig?.apiKey || (callerSuppliedEndpoint ? "" : process.env.OPENAI_API_KEY);
        if (!apiKey || apiKey.trim() === "") {
          throw new Error("Missing OpenAI API Key.");
        }

        const baseUrl = (mergedConfig?.customEndpointUrl || "https://api.openai.com").replace(/\/$/, "");
        const url = `${baseUrl}/v1/chat/completions`;

        const openaiMessages = [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...messages.map(msg => ({
            role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user",
            content: msg.content
          }))
        ];

        const res = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: modelName,
              messages: openaiMessages,
              temperature
            })
          }),
          30000,
          "OpenAI request"
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`OpenAI endpoint error: ${errText}`);
        }

        const data: any = await res.json();
        return { text: data.choices?.[0]?.message?.content || "", raw: data };
      }

      case "groq": {
        const apiKey = mergedConfig?.apiKey || process.env.GROQ_API_KEY;
        if (!apiKey || apiKey.trim() === "") {
          throw new Error("Missing Groq API Key. Register it in Settings → AI Provider.");
        }

        const url = "https://api.groq.com/openai/v1/chat/completions";

        const groqMessages = [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...messages.map(msg => ({
            role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user",
            content: msg.content
          }))
        ];

        const res = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: modelName,
              messages: groqMessages,
              temperature
            })
          }),
          30000,
          "Groq request"
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Groq endpoint error: ${errText}`);
        }

        const data: any = await res.json();
        return { text: data.choices?.[0]?.message?.content || "", raw: data };
      }

      case "custom": {
        const baseUrl = (mergedConfig?.customEndpointUrl || "http://localhost:11434").replace(/\/$/, "");
        const url = `${baseUrl}/chat/completions`;

        const customMessages = [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...messages.map(msg => ({
            role: msg.role === "assistant" || msg.role === "model" ? "assistant" : "user",
            content: msg.content
          }))
        ];

        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };
        const apiKey = mergedConfig?.apiKey;
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const res = await withTimeout(
          fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelName,
              messages: customMessages,
              temperature
            })
          }),
          30000,
          "Custom endpoint request"
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Custom endpoint error: ${errText}`);
        }

        const data: any = await res.json();
        return { text: data.choices?.[0]?.message?.content || "", raw: data };
      }

      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
    })();

    const usage = normalizeUsage(provider, raw);
    recordLlmCall({
      provider,
      model: modelName,
      durationMs: elapsedMs(),
      outcome: "ok",
      inputTokens: usage.input,
      outputTokens: usage.output,
    });
    if (usage.input !== undefined) span.setAttribute("gen_ai.usage.input_tokens", usage.input);
    if (usage.output !== undefined) span.setAttribute("gen_ai.usage.output_tokens", usage.output);
    span.setStatus({ code: SpanStatusCode.OK });
    return text;
  } catch (error: any) {
    recordLlmCall({ provider, model: modelName, durationMs: elapsedMs(), outcome: "error" });
    // The message is recorded on the span, not the key material that may appear in
    // a provider's error body — `error.message` here is our own wrapper text or the
    // provider's, and the redaction in logger.ts does not apply to span attributes.
    span.recordException({ name: "AiRequestFailed", message: String(error?.message ?? "unknown") });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error?.message ?? "unknown") });
    throw new Error(`[${provider}] AI request failed: ${error.message}`);
  } finally {
    span.end();
  }
}
