/** Output templates: "%(title)s [%(id)s].%(ext)s", "%(uploader|unknown)s", "%(title).50s", "%(playlist_index)02d". */

export function sanitize(s: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  return (cleaned || "_").slice(0, 200);
}

export function renderTemplate(tpl: string, fields: Record<string, unknown>): string {
  return tpl.replace(/%%|%\(([A-Za-z_]\w*)(?:\|([^)]*))?\)(?:\.(\d+)s|(0?)(\d*)d|s)/g, (m, key?: string, dflt?: string, max?: string, zero?: string, width?: string) => {
    if (m === "%%") return "%";
    const v = fields[key as string];
    const missing = v === undefined || v === null || typeof v === "object";
    if (m.endsWith("d")) {
      const n = Number(v);
      return sanitize(missing || !Number.isFinite(n) ? (dflt ?? "NA") : String(Math.trunc(n)).padStart(Number(width) || 0, zero ? "0" : " "));
    }
    let s = missing ? (dflt ?? "NA") : String(v);
    if (max) s = s.slice(0, Number(max));
    return sanitize(s);
  });
}
