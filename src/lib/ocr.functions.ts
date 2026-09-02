import { createServerFn } from "@tanstack/react-start";

type OcrInput = { imageBase64: string; mimeType: string };

export const extractScript = createServerFn({ method: "POST" })
  .inputValidator((data: OcrInput) => {
    if (!data?.imageBase64 || !data?.mimeType) throw new Error("Missing image data");
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an OCR assistant for marked university exam scripts.
From the script image, extract:
1. The student's MATRICULATION NUMBER (often handwritten or printed at the top, e.g. "CSC/2020/123" or "20/1234EE" or "U2019/1234567"). Normalize to uppercase, remove spaces.
2. The lecturer's SCORE, written as "score/total" — usually circled, boxed, or highlighted in red/blue ink at the top corner. Examples: "45/60", "12/20", "78/100".

Also report the bounding box of each detected value as [x, y, width, height] using fractions of the image width/height (0..1).
If a value is unreadable or missing, return null for it. Be tolerant of handwriting, ink color, and orientation.

CRITICAL — read every digit of the matric number and score character by character with absolute precision. Handwritten digits are frequently confused: 4 vs 6 vs 9 vs 0, 1 vs 7, 3 vs 5 vs 8. Examine each glyph's shape carefully before deciding. Never guess a digit from context or pattern; only report what is actually written. If you are torn between two digits for a character, prefer the reading where the handwriting stroke is clearest, and lower your confidence accordingly.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "report_extraction",
          description: "Report the extracted matric number and score.",
          parameters: {
            type: "object",
            properties: {
              matric_no: { type: ["string", "null"], description: "Matriculation number, normalized uppercase, no spaces" },
              score: { type: ["number", "null"], description: "The numerator (awarded score)" },
              total: { type: ["number", "null"], description: "The denominator (max score)" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              notes: { type: "string" },
              matric_box: {
                type: ["array", "null"],
                description: "Bounding box of the matric number as [x, y, width, height] in 0..1 fractions of the image",
                items: { type: "number" },
              },
              score_box: {
                type: ["array", "null"],
                description: "Bounding box of the score as [x, y, width, height] in 0..1 fractions of the image",
                items: { type: "number" },
              },
            },
            required: ["matric_no", "score", "total", "confidence"],
            additionalProperties: false,
          },
        },
      },
    ];

    const body = JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract matric number and score from this marked exam script." },
            { type: "image_url", image_url: { url: `data:${data.mimeType};base64,${data.imageBase64}` } },
          ],
        },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "report_extraction" } },
    });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const MAX_ATTEMPTS = 5;
    let resp: Response | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
      });
      if (resp.status !== 429) break;
      if (attempt === MAX_ATTEMPTS - 1) break;
      const retryAfter = Number(resp.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 800 * 2 ** attempt) + Math.floor(Math.random() * 400);
      await sleep(waitMs);
    }

    if (!resp || !resp.ok) {
      if (resp?.status === 429) throw new Error("The scanner is busy (rate limited). Please wait a few seconds and try again.");
      if (resp?.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      const t = resp ? await resp.text() : "no response";
      console.error("AI gateway error:", resp?.status, t);
      throw new Error("OCR service error");
    }

    const json = await resp.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No extraction returned");

    const args = JSON.parse(call.function.arguments);
    return args as {
      matric_no: string | null;
      score: number | null;
      total: number | null;
      confidence: "high" | "medium" | "low";
      notes?: string;
      matric_box?: number[] | null;
      score_box?: number[] | null;
    };
  });
