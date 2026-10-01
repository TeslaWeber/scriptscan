import { createServerFn } from "@tanstack/react-start";

type OcrInput = { imageBase64: string; mimeType: string };

export const extractScript = createServerFn({ method: "POST" })
  .inputValidator((data: OcrInput) => {
    if (!data?.imageBase64 || !data?.mimeType) throw new Error("Missing image data");
    if (!data.mimeType.startsWith("image/")) throw new Error("Invalid image file");
    return data;
  })
  .handler(async ({ data }) => {

    const systemPrompt = `You are an OCR assistant for marked university exam scripts.
From the script image, extract:
1. The student's MATRICULATION NUMBER (often handwritten or printed at the top, e.g. "CSC/2020/123" or "20/1234EE" or "U2019/1234567"). Normalize to uppercase, remove spaces.
2. The lecturer's SCORE, written as "score/total" — usually circled, boxed, or highlighted in red/blue ink at the top corner. Examples: "45/60", "12/20", "78/100".

Also report the bounding box of each detected value as [x, y, width, height] using fractions of the image width/height (0..1).
If a value is unreadable or missing, return null for it. Be tolerant of handwriting, ink color, and orientation.

CRITICAL — read every digit of the matric number and score character by character with absolute precision. Handwritten digits are frequently confused: 4 vs 6 vs 9 vs 0, 1 vs 7, 3 vs 5 vs 8. Examine each glyph's shape carefully before deciding. Never guess a digit from context or pattern; only report what is actually written. If you are torn between two digits for a character, prefer the reading where the handwriting stroke is clearest, and lower your confidence accordingly.`;

    const { geminiJson } = await import("./gemini.server");
    const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type, nullable: true, ...extra });
    const args = await geminiJson<Record<string, unknown>>({
      system: systemPrompt,
      parts: [
        { text: "Extract matric number and score from this marked exam script." },
        { inline_data: { mime_type: data.mimeType, data: data.imageBase64 } },
      ],
      schema: {
        type: "object",
        properties: {
          matric_no: nullable("string"),
          score: nullable("number"),
          total: nullable("number"),
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          notes: { type: "string" },
          matric_box: nullable("array", { items: { type: "number" } }),
          score_box: nullable("array", { items: { type: "number" } }),
        },
        required: ["matric_no", "score", "total", "confidence"],
      },
    });
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
