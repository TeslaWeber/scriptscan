/**
 * Matric pattern helpers.
 *
 * Staff enter a *sample* matric number (e.g. "2016/0001") instead of a regex.
 * We derive a strict regex from the sample's shape:
 *   digits  -> \d{n}
 *   letters -> [A-Za-z]{n}
 *   anything else is treated as a literal separator.
 *
 * Advanced users can still paste a raw regex (anything starting with "^").
 */
export const DEFAULT_MATRIC_SAMPLE = "2016/0001";

export function describePattern(sample: string): string {
  const s = sample.trim();
  if (!s) return "Any value accepted";
  if (s.startsWith("^")) return "Custom regular expression";
  return `Shape of "${s}" — same length and layout`;
}

export function patternToRegex(sample: string): RegExp {
  const s = sample.trim();
  if (!s) return /.*/;
  if (s.startsWith("^")) {
    try {
      return new RegExp(s);
    } catch {
      return /.*/;
    }
  }

  let out = "^";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/[0-9]/.test(ch)) {
      let n = 0;
      while (i < s.length && /[0-9]/.test(s[i]!)) { n++; i++; }
      out += `\\d{${n}}`;
    } else if (/[A-Za-z]/.test(ch)) {
      let n = 0;
      while (i < s.length && /[A-Za-z]/.test(s[i]!)) { n++; i++; }
      out += `[A-Za-z]{${n}}`;
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i++;
    }
  }
  out += "$";
  try {
    return new RegExp(out);
  } catch {
    return /.*/;
  }
}
