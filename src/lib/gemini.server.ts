// Server-only Gemini helper. Reads GEMINI_API_KEY from server env; never shipped to the browser.
// Google retires Gemini model versions regularly, so the model is discovered at runtime from the
// account's own model list instead of being hard-coded. Optional override: GEMINI_MODEL env var.

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

const API = "https://generativelanguage.googleapis.com/v1beta";
const RETRYABLE = [429, 500, 502, 503, 504];

let cachedModels: { list: string[]; at: number } | null = null;

function versionScore(name: string): number {
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Ask Google which models this key can use and rank the best fast multimodal ones first. */
async function discoverModels(apiKey: string): Promise<string[]> {
  if (cachedModels && Date.now() - cachedModels.at < 30 * 60_000) return cachedModels.list;
  const names: string[] = [];
  try {
    let pageToken = "";
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${API}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (!r.ok) break;
      const j = (await r.json()) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      for (const m of j.models ?? []) {
        if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
        const id = m.name.replace(/^models\//, "");
        if (!/^gemini-/.test(id)) continue;
        if (/(tts|image|embedding|live|audio|native|thinking|computer|robotics|exp)/i.test(id)) continue;
        names.push(id);
      }
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
  } catch (e) {
    console.error("Gemini model discovery failed:", e);
  }

  const rank = (id: string) => {
    let s = versionScore(id) * 100;
    if (/flash/.test(id) && !/lite/.test(id)) s += 30;
    else if (/flash-lite/.test(id)) s += 20;
    else if (/pro/.test(id)) s += 10;
    if (/preview/.test(id)) s -= 5;
    if (/-latest$/.test(id)) s += 1;
    return s;
  };
  const list = [...new Set(names)].sort((a, b) => rank(b) - rank(a));
  if (list.length) cachedModels = { list, at: Date.now() };
  return list;
}

function suggestedModel(errorText: string): string | null {
  const m = errorText.match(/use models\/([a-z0-9.\-]+)/i);
  return m ? m[1] : null;
}

export async function geminiJson<T>(opts: {
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");

  const makeBody = (withSchema: boolean) =>
    JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: withSchema
              ? opts.system
              : `${opts.system}\n\nRespond ONLY with a JSON object matching this JSON schema:\n${JSON.stringify(opts.schema)}`,
          },
        ],
      },
      contents: [{ role: "user", parts: opts.parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        ...(withSchema ? { responseSchema: opts.schema } : {}),
      },
    });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const override = process.env.GEMINI_MODEL?.trim();
  const discovered = await discoverModels(apiKey);
  const queue: string[] = [];
  const push = (m: string | null | undefined) => {
    if (m && !queue.includes(m)) queue.push(m);
  };
  push(override);
  discovered.slice(0, 4).forEach(push);
  // Fallbacks used only if the model list could not be read.
  ["gemini-flash-latest", "gemini-3.8-flash", "gemini-flash-lite-latest"].forEach(push);

  let lastStatus = 0;
  let lastText = "";
  const tried = new Set<string>();

  for (let qi = 0; qi < queue.length && tried.size < 6; qi++) {
    const model = queue[qi];
    if (tried.has(model)) continue;
    tried.add(model);
    const url = `${API}/models/${model}:generateContent`;
    let withSchema = true;

    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: makeBody(withSchema),
      });

      if (resp.ok) {
        const json = await resp.json();
        const cand = json?.candidates?.[0];
        const text: string = (cand?.content?.parts ?? [])
          .filter((p: { thought?: boolean }) => !p.thought)
          .map((p: { text?: string }) => p.text ?? "")
          .join("");
        if (!text) {
          const reason = cand?.finishReason || json?.promptFeedback?.blockReason;
          throw new Error(`Gemini returned no result${reason ? ` (${reason})` : ""}. Try a clearer photo or recording.`);
        }
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        try {
          return JSON.parse(cleaned) as T;
        } catch {
          throw new Error("Gemini returned an unreadable result. Please try again.");
        }
      }

      lastStatus = resp.status;
      lastText = await resp.text();
      console.error(`Gemini error [${model}]:`, lastStatus, lastText.slice(0, 500));

      // Schema format rejected by this model version: retry once with the schema in the prompt.
      if (lastStatus === 400 && withSchema && /schema|response_schema|responseSchema|Unknown name|Invalid JSON payload/i.test(lastText)) {
        withSchema = false;
        continue;
      }
      if (RETRYABLE.includes(lastStatus) && attempt < 3) {
        const ra = Number(resp.headers.get("retry-after"));
        await sleep(ra > 0 ? Math.min(ra * 1000, 10000) : 1000 * 2 ** attempt + Math.floor(Math.random() * 400));
        continue;
      }
      break;
    }

    // Model retired / not available / overloaded → move on to the next model.
    if (lastStatus === 404 || RETRYABLE.includes(lastStatus) || (lastStatus === 400 && /model/i.test(lastText) && /not (found|supported|available)/i.test(lastText))) {
      const s = suggestedModel(lastText);
      if (s && !tried.has(s)) queue.splice(qi + 1, 0, s);
      continue;
    }
    break;
  }

  let detail = "";
  try {
    detail = JSON.parse(lastText)?.error?.message ?? "";
  } catch {
    /* ignore */
  }
  if (lastStatus === 429) throw new Error("The scanner is busy (rate limited by Google). Please wait a few seconds and try again.");
  if (lastStatus === 401 || lastStatus === 403) throw new Error(`GEMINI_API_KEY was rejected by Google${detail ? `: ${detail}` : "."}`);
  if (lastStatus === 400) throw new Error(`Gemini could not read that file${detail ? `: ${detail}` : ". Check the image/audio and try again."}`);
  if (lastStatus >= 500) throw new Error("Google Gemini is temporarily overloaded. Please wait a minute and try again.");
  throw new Error(`Gemini service error (${lastStatus || "no response"})${detail ? `: ${detail}` : ""}`);
}
