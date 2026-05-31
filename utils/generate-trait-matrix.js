/**
 * Generates a trait matrix HTML report from the layers folder structure.
 * Shows all traits with images, weights, and occurrence percentages.
 *
 * Run: node utils/generate-trait-matrix.js
 */

const fs = require("fs");
const path = require("path");

const basePath = process.cwd();
const layersDir = path.join(basePath, "layers");
const outputPath = path.join(basePath, "trait-matrix.html");

const { layerConfigurations } = require(`${basePath}/src/config.js`);
const rarityDelimiter = "#";

const getRarityWeight = (str) => {
  const nameWithoutExtension = str.slice(0, -4);
  let weight = Number(nameWithoutExtension.split(rarityDelimiter).pop());
  if (isNaN(weight)) weight = 1;
  return weight;
};

const cleanName = (str) => {
  const nameWithoutExtension = str.slice(0, -4);
  return nameWithoutExtension.split(rarityDelimiter).shift();
};

const getElements = (layerPath) => {
  if (!fs.existsSync(layerPath)) return [];
  return fs
    .readdirSync(layerPath)
    .filter((item) => /\.(png|jpg|jpeg|gif)$/i.test(item))
    .map((filename) => {
      const weight = getRarityWeight(filename);
      const name = cleanName(filename);
      return { name, filename, weight };
    });
};

// Get layer order from config
const layersOrder = layerConfigurations[0].layersOrder.map((l) => l.name);

const allTraits = [];
let totalElements = 0;

layersOrder.forEach((layerName) => {
  const layerPath = path.join(layersDir, layerName);
  const elements = getElements(layerPath);

  if (elements.length === 0) return;

  const totalWeight = elements.reduce((sum, e) => sum + e.weight, 0);
  const elementsWithPct = elements.map((e) => {
    const pct = (e.weight / totalWeight) * 100;
    return {
      ...e,
      percentage: pct.toFixed(2) + "%",
      percentageValue: pct.toFixed(2),
    };
  });

  allTraits.push({
    layer: layerName,
    elements: elementsWithPct,
    totalWeight,
  });
  totalElements += elements.length;
});

// Generate HTML
const htmlSections = allTraits
  .map(
    (trait) => `
  <section class="trait-section">
    <h2>${trait.layer}</h2>
    <p class="layer-summary">${trait.elements.length} elements · Total weight: ${trait.totalWeight}</p>
    <div class="trait-grid">
      ${trait.elements
        .map(
          (e) => `
        <div class="trait-card">
          <div class="trait-image">
            <img src="layers/${trait.layer}/${encodeURIComponent(e.filename)}" alt="${e.name}" title="${e.name}" />
          </div>
          <div class="trait-info">
            <span class="trait-name">${e.name}</span>
            <span class="trait-weight">Weight: ${e.weight}</span>
            <label class="trait-pct-label">Occurrence %:</label>
            <input type="number" step="0.01" min="0" max="100" class="trait-pct-input"
              value="${e.percentageValue}" data-layer="${trait.layer}" data-filename="${e.filename.replace(/"/g, '&quot;')}"
              title="Edit occurrence percentage" />
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  </section>
`
  )
  .join("");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trait Matrix - HashLips Art Engine</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      margin: 0;
      padding: 2rem;
      background: #1a1a2e;
      color: #eee;
    }
    h1 {
      text-align: center;
      margin-bottom: 2rem;
      color: #e94560;
    }
    .trait-section {
      margin-bottom: 3rem;
      padding: 1.5rem;
      background: #16213e;
      border-radius: 12px;
      border: 1px solid #0f3460;
    }
    .trait-section h2 {
      margin: 0 0 0.5rem 0;
      color: #e94560;
      font-size: 1.5rem;
    }
    .layer-summary {
      margin: 0 0 1rem 0;
      color: #8892b0;
      font-size: 0.9rem;
    }
    .trait-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 1rem;
    }
    .trait-card {
      background: #0f3460;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #1a1a2e;
      transition: transform 0.2s;
    }
    .trait-card:hover {
      transform: scale(1.02);
      border-color: #e94560;
    }
    .trait-image {
      aspect-ratio: 1;
      overflow: hidden;
      background: #1a1a2e;
    }
    .trait-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .trait-info {
      padding: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.8rem;
    }
    .trait-name {
      font-weight: 600;
      color: #fff;
      word-break: break-word;
    }
    .trait-weight {
      color: #8892b0;
    }
    .trait-pct-label {
      color: #e94560;
      font-weight: 600;
      font-size: 0.75rem;
    }
    .trait-pct-input {
      width: 100%;
      padding: 0.25rem 0.35rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #e94560;
      background: #1a1a2e;
      border: 1px solid #0f3460;
      border-radius: 4px;
    }
    .trait-pct-input:focus {
      outline: none;
      border-color: #e94560;
    }
    .trait-pct-input::-webkit-inner-spin-button { opacity: 0.7; }
    .actions-bar {
      display: flex;
      gap: 1rem;
      justify-content: center;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    .btn {
      padding: 0.6rem 1.2rem;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-export {
      background: #e94560;
      color: #fff;
    }
    .btn-export:hover { background: #ff6b6b; }
    .btn-reset {
      background: #0f3460;
      color: #eee;
    }
    .btn-reset:hover { background: #16213e; }
    .footer {
      text-align: center;
      margin-top: 2rem;
      color: #8892b0;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <h1>Trait Matrix — All Traits with Occurrence %</h1>
  <div class="actions-bar">
    <button class="btn btn-export" onclick="exportCustomPercentages()">Export Custom Percentages (CSV)</button>
    <button class="btn btn-reset" onclick="resetToCalculated()">Reset All to Calculated Values</button>
  </div>
  ${htmlSections}
  <p class="footer">Generated from layers/ · ${totalElements} total elements across ${allTraits.length} trait types</p>
  <script>
    const defaultValues = ${JSON.stringify(
      allTraits.flatMap((t) =>
        t.elements.map((e) => ({
          layer: t.layer,
          filename: e.filename,
          value: e.percentageValue,
        }))
      )
    )};
    function getDefault(layer, filename) {
      return defaultValues.find((d) => d.layer === layer && d.filename === filename)?.value ?? "";
    }
    function exportCustomPercentages() {
      const rows = [["Trait Type","Element Name","Filename","Custom %"]];
      document.querySelectorAll(".trait-pct-input").forEach((input) => {
        const layer = input.dataset.layer;
        const filename = input.dataset.filename;
        const name = filename.split("#")[0].replace(/\.png$/i, "") || filename;
        rows.push([layer, name, filename, input.value]);
      });
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "custom-percentages.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function resetToCalculated() {
      document.querySelectorAll(".trait-pct-input").forEach((input) => {
        input.value = getDefault(input.dataset.layer, input.dataset.filename);
      });
    }
  </script>
</body>
</html>`;

fs.writeFileSync(outputPath, html, "utf8");

// Also generate CSV for Excel
const csvPath = path.join(basePath, "trait-matrix.csv");
const csvRows = ["Trait Type,Element Name,Filename,Weight,Occurrence %"];
allTraits.forEach((trait) => {
  trait.elements.forEach((e) => {
    csvRows.push(
      `"${trait.layer}","${e.name}","${e.filename}",${e.weight},${e.percentage}`
    );
  });
});
fs.writeFileSync(csvPath, csvRows.join("\n"), "utf8");

console.log(`Trait matrix saved to: ${outputPath}`);
console.log(`CSV (for Excel) saved to: ${csvPath}`);
console.log(`Open the HTML in a browser to view all traits with images and percentages.`);
