import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

export default function TraitMatrix({ projectId }) {
  const [layers, setLayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    loadTraits();
  }, [projectId]);

  async function loadTraits() {
    const { data: layerData } = await supabase
      .from("project_layers")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    if (!layerData?.length) {
      setLayers([]);
      setLoading(false);
      return;
    }

    const { data: traitData } = await supabase
      .from("traits")
      .select("*")
      .in("layer_id", layerData.map((l) => l.id));

    const enriched = layerData.map((layer) => {
      const traits = (traitData || []).filter((t) => t.layer_id === layer.id);
      const totalWeight = traits.reduce((s, t) => s + t.weight, 0);
      return {
        ...layer,
        traits: traits.map((t) => ({
          ...t,
          percentage: totalWeight > 0 ? ((t.weight / totalWeight) * 100).toFixed(1) : "0",
        })),
        totalWeight,
      };
    });

    setLayers(enriched);
    setLoading(false);
  }

  async function updateWeight(traitId, weight) {
    setSaving(traitId);
    await supabase.from("traits").update({ weight: parseInt(weight, 10) || 1 }).eq("id", traitId);
    await loadTraits();
    setSaving(null);
  }

  function exportCsv() {
    const rows = [["Layer", "Trait", "Weight", "Percentage"]];
    layers.forEach((layer) => {
      layer.traits.forEach((t) => {
        rows.push([layer.name, t.name, t.weight, `${t.percentage}%`]);
      });
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trait-matrix.csv";
    a.click();
  }

  if (loading) {
    return <div className="animate-pulse h-48 bg-zinc-800/30 rounded-2xl" />;
  }

  if (!layers.length) {
    return (
      <p className="text-sm text-zinc-500 text-center py-8">
        Upload layers to see the trait matrix
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-xs text-zinc-500 max-w-lg">
          Previews load per layer as you scroll — small WebP thumbs, not full trait files,
          to keep Supabase egress low.
        </p>
        <button
          onClick={exportCsv}
          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
        >
          Export CSV
        </button>
      </div>

      {layers.map((layer) => (
        <LayerSection
          key={layer.id}
          projectId={projectId}
          layer={layer}
          saving={saving}
          onWeightChange={updateWeight}
        />
      ))}
    </div>
  );
}

function LayerSection({ projectId, layer, saving, onWeightChange }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [previewUrls, setPreviewUrls] = useState(null);
  const [loadingPreviews, setLoadingPreviews] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || previewUrls || loadingPreviews) return;
    let active = true;
    setLoadingPreviews(true);
    api
      .getTraitPreviews(projectId, layer.id)
      .then(({ urls }) => {
        if (active) setPreviewUrls(urls || {});
      })
      .catch(() => {
        if (active) setPreviewUrls({});
      })
      .finally(() => {
        if (active) setLoadingPreviews(false);
      });
    return () => {
      active = false;
    };
  }, [visible, projectId, layer.id, previewUrls, loadingPreviews]);

  return (
    <section ref={ref}>
      <h3 className="text-lg font-semibold text-white mb-1">{layer.name}</h3>
      <p className="text-xs text-zinc-500 mb-4">
        {layer.traits.length} traits · total weight {layer.totalWeight}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {layer.traits.map((trait) => (
          <TraitCard
            key={trait.id}
            trait={trait}
            imgUrl={previewUrls?.[trait.id]}
            loadingPreview={visible && loadingPreviews}
            saving={saving === trait.id}
            onWeightChange={(w) => onWeightChange(trait.id, w)}
          />
        ))}
      </div>
    </section>
  );
}

function TraitCard({ trait, imgUrl, loadingPreview, saving, onWeightChange }) {
  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-2">
        <div className="aspect-square rounded-lg overflow-hidden bg-zinc-900 mb-2">
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={trait.name}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : loadingPreview ? (
            <div className="w-full h-full animate-pulse bg-zinc-800" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600 px-2 text-center">
              Scroll to load preview
            </div>
          )}
        </div>
        <p className="text-xs font-medium text-white truncate">{trait.name}</p>
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            min="1"
            value={trait.weight}
            onChange={(e) => onWeightChange(e.target.value)}
            disabled={saving}
            className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-white"
          />
          <span className="text-xs text-zinc-500">{trait.percentage}%</span>
        </div>
      </div>
    </div>
  );
}
