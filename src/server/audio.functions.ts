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
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

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

    const tools = [
      {
        type: "function",
        function: {
          name: "report_entries",
          description: "Report every dictated student record.",
          parameters: {
            type: "object",
            properties: {
              entries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    matric_no: { type: ["string", "null"] },
                    score: { type: ["number", "null"] },
                    total: { type: ["number", "null"] },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    notes: { type: "string" },
                  },
                  required: ["matric_no", "score", "total", "confidence"],
                  additionalProperties: false,
                },
              },
              transcript: { type: "string", description: "Raw transcript of the audio" },
            },
            required: ["entries"],
            additionalProperties: false,
          },
        },
      },
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract every dictated matric number and score from this recording." },
              { type: "input_audio", input_audio: { data: data.audioBase64, format: data.format } },
            ],
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_entries" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) throw new Error("Rate limit exceeded. Please wait and try again.");
      if (resp.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      const t = await resp.text();
      console.error("AI gateway audio error:", resp.status, t);
      throw new Error("Voice capture service error");
    }

    const json = await resp.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No entries returned");
    const args = JSON.parse(call.function.arguments) as { entries: DictatedEntry[]; transcript?: string };
    return { entries: args.entries ?? [], transcript: args.transcript ?? "" };
  });
