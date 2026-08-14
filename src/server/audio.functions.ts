import { createServerFn } from "@tanstack/react-start";

type AudioInput = { audioBase64: string; mimeType: string; pattern?: string };

function extToMime(mime: string) {
  const m = mime.split(";")[0];
  return (
    {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
    }[m] ?? "webm"
  );
}

export const transcribeEntries = createServerFn({ method: "POST" })
  .inputValidator((data: AudioInput) => {
    if (!data?.audioBase64) throw new Error("Missing audio data");
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    if (bytes.length < 2048) throw new Error("Recording was too short — please try again");

    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe");
    form.append(
      "file",
      new Blob([bytes], { type: data.mimeType || "audio/webm" }),
      `recording.${extToMime(data.mimeType || "audio/webm")}`,
    );

    const tr = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!tr.ok) {
      const t = await tr.text().catch(() => "");
      if (tr.status === 429) throw new Error("Rate limit exceeded. Please wait and try again.");
      if (tr.status === 402) throw new Error("AI credits exhausted.");
      console.error("Transcription error", tr.status, t);
      throw new Error(`Transcription failed (${tr.status})`);
    }
    const trJson: any = await tr.json();
    const transcript: string = trJson?.text ?? "";
    if (!transcript.trim()) throw new Error("Nothing was heard in the recording");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        messages: [
          {
            role: "system",
            content: `You convert a spoken dictation of exam results into structured rows.
Each spoken entry contains a student matriculation number followed by a score.
Matric numbers look like this example pattern: ${data.pattern || "2016/0001"}.
Spoken forms may say "slash", "stroke", "over", or run digits together — normalize to the pattern above (uppercase, no spaces).
Score may be spoken as "score 45", "45 over 60", or just a number. If a total (denominator) is spoken, capture it, else null.
Return every entry you can identify, in the order spoken. Ignore filler words.`,
          },
          { role: "user", content: `Transcript:\n${transcript}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_entries",
              description: "Report all dictated result entries.",
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
                      },
                      required: ["matric_no", "score", "total", "confidence"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["entries"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_entries" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      if (resp.status === 429) throw new Error("Rate limit exceeded. Please wait and try again.");
      if (resp.status === 402) throw new Error("AI credits exhausted.");
      console.error("Parse error", resp.status, t);
      throw new Error("Could not understand the dictation");
    }
    const json: any = await resp.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call ? JSON.parse(call.function.arguments) : { entries: [] };
    return {
      transcript,
      entries: (args.entries ?? []) as {
        matric_no: string | null;
        score: number | null;
        total: number | null;
        confidence: "high" | "medium" | "low";
      }[],
    };
  });
