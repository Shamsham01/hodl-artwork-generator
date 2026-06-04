function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** @param {unknown[][]} rows */
export function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** @param {{ total: number, rarity: Array<{ trait_type: string, values: Array<{ value: string, count: number, percentage: number }> }> }} result */
export function rarityReportToRows(result) {
  const rows = [["Layer", "Trait", "Count", "Percentage"]];
  for (const layer of result.rarity || []) {
    for (const v of layer.values || []) {
      rows.push([layer.trait_type, v.value, v.count, `${v.percentage}%`]);
    }
  }
  return rows;
}

export function downloadRarityReportCsv(result, filename = "rarity-report.csv") {
  const rows = [
    ["Total editions", result.total ?? 0],
    [],
    ...rarityReportToRows(result),
  ];
  downloadCsv(rows, filename);
}
