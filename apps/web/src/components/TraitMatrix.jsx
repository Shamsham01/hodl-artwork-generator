import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { loadLayerPreviewUrls, signTraitFullUrl } from "../lib/traitPreviews";

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
          Previews load per layer as you scroll — WebP thumbs when available, otherwise
          a one-time full PNG fallback while thumbs are generated.
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
  const [previewError, setPreviewError] = useState(false);
  const fetchGen = useRef(0);

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
    if (!visible || previewUrls !== null || loadingPreviews) return;

    const gen = ++fetchGen.current;
    let active = true;
    setLoadingPreviews(true);
    setPreviewError(false);

    loadLayerPreviewUrls(layer.traits, {
      batchSize: 25,
      onProgress: (urls) => {
        if (active && gen === fetchGen.current) setPreviewUrls({ ...urls });
      },
    })
      .then((urls) => {
        if (!active || gen !== fetchGen.current) return;
        setPreviewUrls(urls);
      })
      .catch(() => {
        if (!active || gen !== fetchGen.current) return;
        setPreviewError(true);
        setPreviewUrls(null);
      })
      .finally(() => {
        if (active && gen === fetchGen.current) setLoadingPreviews(false);
      });

    // Ask API to build missing WebP thumbs in storage for future visits (non-blocking).
    api.getTraitPreviews(projectId, layer.id, { offset: 0, limit: 40 }).catch(() => {});

    return () => {
      active = false;
    };
  }, [visible, projectId, layer.id, layer.traits, previewUrls, loadingPreviews]);

  function retryPreviews() {
    fetchGen.current++;
    setPreviewUrls(null);
    setPreviewError(false);
  }

  const loadedCount =
    previewUrls && Object.values(previewUrls).filter(Boolean).length;

  return (
    <section ref={ref}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-lg font-semibold text-white">{layer.name}</h3>
        {previewError && (
          <button
            type="button"
            onClick={retryPreviews}
            className="text-xs text-emerald-400 hover:text-emerald-300 shrink-0"
          >
            Retry previews
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        {layer.traits.length} traits · total weight {layer.totalWeight}
        {loadedCount > 0 && ` · ${loadedCount} previews loaded`}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {layer.traits.map((trait) => (
          <TraitCard
            key={trait.id}
            trait={trait}
            imgUrl={previewUrls?.[trait.id]}
            loadingPreview={visible && loadingPreviews && !previewUrls?.[trait.id]}
            previewFailed={previewUrls !== null && !previewUrls[trait.id] && !loadingPreviews}
            saving={saving === trait.id}
            onWeightChange={(w) => onWeightChange(trait.id, w)}
          />
        ))}
      </div>
    </section>
  );
}

function TraitCard({ trait, imgUrl, loadingPreview, previewFailed, saving, onWeightChange }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const triedFull = useRef(false);

  useEffect(() => {
    triedFull.current = false;
    setFailed(false);
    setSrc(imgUrl || null);
  }, [imgUrl, trait.storage_path]);

  async function handleImgError() {
    if (triedFull.current || !trait.storage_path) {
      setFailed(true);
      return;
    }
    triedFull.current = true;
    const fullUrl = await signTraitFullUrl(trait.storage_path);
    if (fullUrl) {
      setSrc(fullUrl);
    } else {
      setFailed(true);
    }
  }

  const showImage = src && !failed;

  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-2">
        <div className="aspect-square rounded-lg overflow-hidden bg-zinc-900 mb-2">
          {showImage ? (
            <img
              src={src}
              alt={trait.name}
              loading="lazy"
              onError={handleImgError}
              className="w-full h-full object-cover"
            />
          ) : loadingPreview && !previewFailed && !failed ? (
            <div className="w-full h-full animate-pulse bg-zinc-800" />
          ) : previewFailed || failed ? (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 px-2 text-center">
              Preview unavailable
            </div>
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
