import { createServerFn } from "@tanstack/react-start";

type AudioInput = { audioBase64: string; format: string; sample?: string };

export type DictatedEntry = {
  matric_no: string | null;
  score: number | null;
  total: number | null;
  confidence: "high" | "medium" | "low";
  notes?: string;
};

export const extractFromAudio = createServerFn({ method: "POST" })
  .inputValidator((data: AudioInput) => {
    if (!data?.audioBase64) throw new Error("Missing audio data");
    if (!data?.format) throw new Error("Missing audio format");
    return data;
  })
  .handler(async ({ data }) => {

    const shape = data.sample?.trim()
      ? `Matriculation numbers in this institution look like "${data.sample.trim()}". Normalize spoken digits and separators to that shape (spoken "slash", "stroke", "dash" are separators).`
      : "Normalize matriculation numbers to uppercase with no spaces.";

    const systemPrompt = `You transcribe a university staff member dictating exam results and convert them into structured records.

The speaker reads a matriculation number followed by a score, one student at a time, e.g.
"2016/0041, score 45", "twenty sixteen slash oh oh four one, forty five out of sixty".

${shape}

Rules:
- Return one entry per student mentioned, in the spoken order.
- score is the awarded mark; total is the maximum if stated ("out of 60", "45 over 60"), otherwise null.
- If a matric number or score is unclear, still return the entry with null for the unclear field and a low confidence plus a short note.
- Never invent students that were not spoken.`;

    const { geminiJson } = await import("./gemini.server");
    const fmt = data.format.toLowerCase();
    const mime = fmt.includes("/") ? fmt : `audio/${fmt === "mp3" ? "mpeg" : fmt}`;
    const args = await geminiJson<{ entries: DictatedEntry[]; transcript?: string }>({
      system: systemPrompt,
      parts: [
        { text: "Extract every dictated matric number and score from this recording." },
        { inline_data: { mime_type: mime, data: data.audioBase64 } },
      ],
      schema: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                matric_no: { type: "string", nullable: true },
                score: { type: "number", nullable: true },
                total: { type: "number", nullable: true },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                notes: { type: "string" },
              },
              required: ["matric_no", "score", "total", "confidence"],
            },
          },
          transcript: { type: "string" },
        },
        required: ["entries"],
      },
    });
    return { entries: args.entries ?? [], transcript: args.transcript ?? "" };
  });
