import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export type ExportRow = {
  matric: string;
  score: number;
  confidence?: string | null;
  error?: string | null;
};

export type ExportVersion = {
  id: string;
  course: string;
  version: number;
  filename: string;
  record_count: number;
  rows: ExportRow[];
  created_at: string;
};

/** Build and download an .xlsx with traceability columns. */
export function downloadScoresWorkbook(rows: ExportRow[], filename: string) {
  const aoa: (string | number)[][] = [
    ["MATRIC NO.", "SCORE", "CONFIDENCE", "ERROR / NOTES"],
    ...rows.map((r) => [r.matric, r.score, r.confidence ?? "", r.error ?? ""]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 40 }];
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: 3 } });
  for (let i = 2; i <= aoa.length; i++) {
    const c = ws[`B${i}`];
    if (c) c.t = "n";
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Scores");
  XLSX.writeFile(wb, filename);
}

/** Save a new numbered version of an export so it can be reopened later. */
export async function saveExportVersion(course: string, rows: ExportRow[]) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;
  const { data: last } = await supabase
    .from("export_versions")
    .select("version")
    .eq("course", course)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const filename = `${course.replace(/\s+/g, "_")}_scores_v${version}.xlsx`;
  const { data, error } = await supabase
    .from("export_versions")
    .insert({ user_id: userId, course, version, filename, record_count: rows.length, rows: rows as any })
    .select()
    .single();
  if (error) return { version, filename, error: error.message };
  return { version, filename, id: data.id };
}
