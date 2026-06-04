import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { fetchTraitPreviewBlobUrl, revokeBlobUrl } from "../lib/traitPreviews";
import { ensureTraitThumb } from "../lib/traitThumbs";

const DEFAULT_TRAIT_WEIGHT = 100;

function layerSectionId(layerId) {
  return `trait-layer-${layerId}`;
}

function sortTraitsStable(traits) {
  return [...traits].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function enrichLayer(layer, traitData) {
  const traits = sortTraitsStable(
    (traitData || []).filter((t) => t.layer_id === layer.id)
  );
  const totalWeight = traits.reduce((s, t) => s + t.weight, 0);
  return {
    ...layer,
    traits: traits.map((t) => ({
      ...t,
      percentage:
        totalWeight > 0 ? ((t.weight / totalWeight) * 100).toFixed(1) : "0",
    })),
    totalWeight,
  };
}

export default function TraitMatrix({ projectId }) {
  const [layers, setLayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [activeLayerId, setActiveLayerId] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const sectionRefs = useRef({});

  useEffect(() => {
    loadTraits();
  }, [projectId]);

  useEffect(() => {
    if (!layers.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          const id = visible[0].target.id.replace("trait-layer-", "");
          setActiveLayerId(id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.15, 0.4] }
    );

    layers.forEach((layer) => {
      const el = sectionRefs.current[layer.id];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [layers]);

  useEffect(() => {
    function onScroll() {
      setShowBackToTop(window.scrollY > 400);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

    const enriched = layerData.map((layer) => enrichLayer(layer, traitData));
    setLayers(enriched);
    setActiveLayerId(enriched[0]?.id ?? null);
    setLoading(false);
  }

  async function updateWeight(traitId, weight) {
    const w = Math.max(1, parseInt(weight, 10) || DEFAULT_TRAIT_WEIGHT);
    setSaving(traitId);

    const { error } = await supabase
      .from("traits")
      .update({ weight: w })
      .eq("id", traitId);

    if (error) {
      setSaving(null);
      return;
    }

    setLayers((prev) =>
      prev.map((layer) => {
        const traits = sortTraitsStable(
          layer.traits.map((t) => (t.id === traitId ? { ...t, weight: w } : t))
        );
        const totalWeight = traits.reduce((s, t) => s + t.weight, 0);
        return {
          ...layer,
          traits: traits.map((t) => ({
            ...t,
            percentage:
              totalWeight > 0
                ? ((t.weight / totalWeight) * 100).toFixed(1)
                : "0",
          })),
          totalWeight,
        };
      })
    );
    setSaving(null);
  }

  function scrollToLayer(layerId) {
    const el = sectionRefs.current[layerId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveLayerId(layerId);
    }
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
    URL.revokeObjectURL(url);
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
    <div className="relative">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <p className="text-xs text-zinc-500 max-w-lg">
          Trait previews use 512px WebP thumbs (~25–50 KB) in Storage — less egress than
          full PNGs. Opening this page builds upgraded thumbs in the background.
        </p>
        <button
          onClick={exportCsv}
          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
        >
          Export CSV
        </button>
      </div>

      {/* Mobile / tablet: sticky layer strip */}
      <div className="lg:hidden sticky top-24 z-20 -mx-1 mb-6">
        <div className="glass-panel rounded-2xl p-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 mb-1.5">
            Jump to layer
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
            {layers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => scrollToLayer(layer.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeLayerId === layer.id
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                    : "text-zinc-400 border border-zinc-700/80 hover:text-zinc-200"
                }`}
              >
                {layer.name}
                <span className="ml-1 text-zinc-600">({layer.traits.length})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Desktop: layer sections sidebar */}
        <aside className="hidden lg:block w-44 xl:w-52 shrink-0">
          <nav
            className="sticky top-32 max-h-[calc(100dvh-10rem)] overflow-y-auto rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-2"
            aria-label="Layer sections"
          >
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 py-1.5 mb-1">
              Layers
            </p>
            <ul className="space-y-0.5">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <button
                    type="button"
                    onClick={() => scrollToLayer(layer.id)}
                    className={`w-full text-left rounded-lg px-2.5 py-2 text-xs transition-colors ${
                      activeLayerId === layer.id
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                    }`}
                  >
                    <span className="font-medium block truncate">{layer.name}</span>
                    <span className="text-[10px] text-zinc-600">
                      {layer.traits.length} traits
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="flex-1 min-w-0 space-y-10">
          {layers.map((layer) => (
            <LayerSection
              key={layer.id}
              layer={layer}
              saving={saving}
              onWeightChange={updateWeight}
              sectionRef={(el) => {
                sectionRefs.current[layer.id] = el;
              }}
            />
          ))}
        </div>
      </div>

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 rounded-full glass-panel px-4 py-2.5 text-xs font-medium text-zinc-300 hover:text-white shadow-lg transition-colors"
          aria-label="Back to top"
        >
          <ArrowUp size={16} weight="bold" />
          Top
        </button>
      )}
    </div>
  );
}

function LayerSection({ layer, saving, onWeightChange, sectionRef }) {
  return (
    <section
      id={layerSectionId(layer.id)}
      ref={sectionRef}
      className="scroll-mt-36"
    >
      <h3 className="text-lg font-semibold text-white mb-1">{layer.name}</h3>
      <p className="text-xs text-zinc-500 mb-4">
        {layer.traits.length} traits · total weight {layer.totalWeight}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {layer.traits.map((trait) => (
          <TraitCard
            key={trait.id}
            trait={trait}
            saving={saving === trait.id}
            onWeightChange={(w) => onWeightChange(trait.id, w)}
          />
        ))}
      </div>
    </section>
  );
}

function TraitCard({ trait, saving, onWeightChange }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState(null);
  const [status, setStatus] = useState("idle");

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
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !trait.storage_path) return;

    let cancelled = false;
    setStatus("loading");

    (async () => {
      await ensureTraitThumb(trait.storage_path).catch(() => {});
      return fetchTraitPreviewBlobUrl(trait.storage_path);
    })()
      .then((blobUrl) => {
        if (cancelled) {
          revokeBlobUrl(blobUrl);
          return;
        }
        if (blobUrl) {
          setSrc(blobUrl);
          setStatus("done");
        } else {
          setStatus("failed");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [visible, trait.storage_path]);

  useEffect(() => {
    return () => revokeBlobUrl(src);
  }, [src]);

  return (
    <div ref={ref} className="bezel-outer">
      <div className="bezel-inner p-2">
        <div className="aspect-square rounded-lg overflow-hidden bg-zinc-900 mb-2">
          {src ? (
            <img
              src={src}
              alt={trait.name}
              className="w-full h-full object-cover"
            />
          ) : status === "failed" ? (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 px-2 text-center">
              {!trait.storage_path ? "No file path" : "Preview unavailable"}
            </div>
          ) : status === "loading" ? (
            <div className="w-full h-full animate-pulse bg-zinc-800" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600 px-2 text-center">
              …
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
