// Server-only Gemini helper. Reads GEMINI_API_KEY from server env; never shipped to the browser.
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function geminiJson<T>(opts: {
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: opts.schema,
    },
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let resp: Response | null = null;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 0; attempt < 3; attempt++) {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      if (resp.ok || ![429, 500, 502, 503, 504].includes(resp.status)) break;
      if (attempt < 2) await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 400));
    }
    // Move to the next model only when this one is unavailable/overloaded.
    if (resp && (resp.ok || ![404, 500, 502, 503, 504].includes(resp.status))) break;
  }

  if (!resp || !resp.ok) {
    const status = resp?.status;
    const t = resp ? await resp.text() : "no response";
    console.error("Gemini error:", status, t);
    if (status === 429) throw new Error("The scanner is busy (rate limited). Please wait a few seconds and try again.");
    if (status === 400) throw new Error("Gemini could not read that file. Check the image/audio and try again.");
    if (status === 401 || status === 403) throw new Error("GEMINI_API_KEY was rejected. Check the key on the server.");
    let detail = "";
    try { detail = JSON.parse(t)?.error?.message ?? ""; } catch { /* ignore */ }
    if (status === 503 || status === 500) throw new Error("Google Gemini is temporarily overloaded. Please wait a minute and try again.");
    throw new Error(`Gemini service error (${status ?? "no response"})${detail ? `: ${detail}` : ""}`);
  }

  const json = await resp.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no result.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Gemini returned an unreadable result.");
  }
}
