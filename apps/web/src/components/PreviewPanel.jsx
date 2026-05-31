import { useEffect, useState } from "react";
import { Shuffle, Eye } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

export default function PreviewPanel({ projectId }) {
  const [layers, setLayers] = useState([]);
  const [selections, setSelections] = useState({});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadLayers();
  }, [projectId]);

  async function loadLayers() {
    const { data: layerData } = await supabase
      .from("project_layers")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    const { data: traitData } = await supabase
      .from("traits")
      .select("*")
      .in("layer_id", (layerData || []).map((l) => l.id));

    const enriched = (layerData || []).map((layer) => ({
      ...layer,
      traits: (traitData || []).filter((t) => t.layer_id === layer.id),
    }));

    setLayers(enriched);

    const defaults = {};
    enriched.forEach((l) => {
      if (l.traits.length) defaults[l.name] = l.traits[0].name;
    });
    setSelections(defaults);
  }

  function randomize() {
    const next = {};
    layers.forEach((l) => {
      if (l.traits.length) {
        const totalWeight = l.traits.reduce((s, t) => s + t.weight, 0);
        let random = Math.floor(Math.random() * totalWeight);
        for (const t of l.traits) {
          random -= t.weight;
          if (random < 0) {
            next[l.name] = t.name;
            break;
          }
        }
        if (!next[l.name]) next[l.name] = l.traits[l.traits.length - 1].name;
      }
    });
    setSelections(next);
  }

  async function generatePreview() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.preview(projectId, selections);
      setPreview(result);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  if (!layers.length) {
    return <p className="text-sm text-zinc-500 text-center py-8">Upload layers to preview</p>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={randomize}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <Shuffle size={16} />
            Randomize
          </button>
        </div>

        {layers.map((layer) => (
          <div key={layer.id}>
            <label className="text-xs text-zinc-500 block mb-1">{layer.name}</label>
            <select
              value={selections[layer.name] || ""}
              onChange={(e) =>
                setSelections((prev) => ({ ...prev, [layer.name]: e.target.value }))
              }
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {layer.traits.map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
        ))}

        <button
          onClick={generatePreview}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          <Eye size={18} weight="bold" />
          {loading ? "Rendering..." : "Preview"}
        </button>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
      </div>

      <div className="bezel-outer">
        <div className="bezel-inner aspect-square flex items-center justify-center overflow-hidden">
          {preview?.image ? (
            <img
              src={`data:image/png;base64,${preview.image}`}
              alt="NFT preview"
              className="w-full h-full object-contain"
            />
          ) : (
            <p className="text-sm text-zinc-600">Preview will appear here</p>
          )}
        </div>
        {preview?.attributes && (
          <div className="mt-4 flex flex-wrap gap-2">
            {preview.attributes.map((a) => (
              <span
                key={`${a.trait_type}-${a.value}`}
                className="text-xs px-2 py-1 rounded-full bg-zinc-800 text-zinc-400"
              >
                {a.trait_type}: {a.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
