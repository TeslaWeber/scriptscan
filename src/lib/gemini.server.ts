// Server-only Gemini helper. Reads GEMINI_API_KEY from server env; never shipped to the browser.
const MODEL = "gemini-2.5-flash";

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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let resp: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body,
    });
    if (resp.status !== 429 && resp.status !== 503) break;
    if (attempt === 4) break;
    await sleep(Math.min(8000, 800 * 2 ** attempt) + Math.floor(Math.random() * 400));
  }

  if (!resp || !resp.ok) {
    const status = resp?.status;
    const t = resp ? await resp.text() : "no response";
    console.error("Gemini error:", status, t);
    if (status === 429) throw new Error("The scanner is busy (rate limited). Please wait a few seconds and try again.");
    if (status === 400) throw new Error("Gemini could not read that file. Check the image/audio and try again.");
    if (status === 401 || status === 403) throw new Error("GEMINI_API_KEY was rejected. Check the key on the server.");
    throw new Error("Gemini service error. Please try again.");
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
