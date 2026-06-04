import { useEffect, useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, X } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { fetchTraitPreviewBlobUrl, revokeBlobUrl } from "../lib/traitPreviews";
import { ensureTraitThumb } from "../lib/traitThumbs";
import { downloadCsv } from "../lib/downloadCsv";

const DEFAULT_TRAIT_WEIGHT = 100;

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
  const [expandedLayerIds, setExpandedLayerIds] = useState(() => new Set());
  const [traitSearch, setTraitSearch] = useState("");

  const searchQuery = traitSearch.trim().toLowerCase();
  const filteredLayers = layers
    .map((layer) => ({
      ...layer,
      traits: searchQuery
        ? layer.traits.filter((t) => t.name.toLowerCase().includes(searchQuery))
        : layer.traits,
    }))
    .filter((layer) => !searchQuery || layer.traits.length > 0);

  useEffect(() => {
    loadTraits();
  }, [projectId]);

  useEffect(() => {
    if (!searchQuery) return;
    const matching = layers
      .map((layer) => ({
        ...layer,
        traits: layer.traits.filter((t) =>
          t.name.toLowerCase().includes(searchQuery)
        ),
      }))
      .filter((layer) => layer.traits.length > 0);
    setExpandedLayerIds(new Set(matching.map((l) => l.id)));
  }, [searchQuery, layers]);

  async function loadTraits() {
    const { data: layerData } = await supabase
      .from("project_layers")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    if (!layerData?.length) {
      setLayers([]);
      setExpandedLayerIds(new Set());
      setLoading(false);
      return;
    }

    const { data: traitData } = await supabase
      .from("traits")
      .select("*")
      .in("layer_id", layerData.map((l) => l.id));

    setLayers(layerData.map((layer) => enrichLayer(layer, traitData)));
    setExpandedLayerIds(new Set());
    setLoading(false);
  }

  function toggleLayer(layerId) {
    setExpandedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }

  function expandAll() {
    setExpandedLayerIds(new Set(filteredLayers.map((l) => l.id)));
  }

  function collapseAll() {
    setExpandedLayerIds(new Set());
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

  async function bulkUpdateLayerWeights(layerId, weight) {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer?.traits.length) return;

    const w = Math.max(1, parseInt(weight, 10) || DEFAULT_TRAIT_WEIGHT);
    const traitIds = layer.traits.map((t) => t.id);
    setSaving(`bulk-${layerId}`);

    const { error } = await supabase
      .from("traits")
      .update({ weight: w })
      .in("id", traitIds);

    if (error) {
      setSaving(null);
      return;
    }

    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l;
        const traits = sortTraitsStable(
          l.traits.map((t) => ({ ...t, weight: w }))
        );
        const totalWeight = traits.reduce((s, t) => s + t.weight, 0);
        return {
          ...l,
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

  function exportCsv() {
    const rows = [["Layer", "Trait", "Weight", "Percentage"]];
    layers.forEach((layer) => {
      layer.traits.forEach((t) => {
        rows.push([layer.name, t.name, t.weight, `${t.percentage}%`]);
      });
    });
    downloadCsv(rows, "trait-matrix.csv");
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
    <div className="space-y-4">
      <div className="flex flex-col gap-4 mb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs text-zinc-500 max-w-lg">
            Open a layer to set trait weights (higher = more common). Collapse when done
            and move to the next layer. Search finds traits across all layers.
          </p>
          <button
            onClick={exportCsv}
            className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
          >
            Export CSV
          </button>
        </div>

        <div className="relative max-w-md">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="search"
            value={traitSearch}
            onChange={(e) => setTraitSearch(e.target.value)}
            placeholder="Search traits by name…"
            className="w-full bg-zinc-900/80 border border-zinc-700 rounded-xl pl-9 pr-9 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
          />
          {traitSearch && (
            <button
              type="button"
              onClick={() => setTraitSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white rounded-lg"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="text-xs text-zinc-500">
            Showing {filteredLayers.reduce((n, l) => n + l.traits.length, 0)} matching
            trait(s) in {filteredLayers.length} layer(s)
          </p>
        )}
      </div>

      {filteredLayers.length > 1 && (
        <div className="flex justify-end gap-3 text-xs">
          <button
            type="button"
            onClick={expandAll}
            className="text-zinc-500 hover:text-emerald-400 transition-colors"
          >
            Expand all layers
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-zinc-500 hover:text-emerald-400 transition-colors"
          >
            Collapse all
          </button>
        </div>
      )}

      <div className="space-y-3">
        {filteredLayers.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-12">
            No traits match &ldquo;{traitSearch}&rdquo;
          </p>
        ) : (
          filteredLayers.map((layer) => {
            const fullLayer = layers.find((l) => l.id === layer.id) || layer;
            return (
              <LayerSection
                key={layer.id}
                layer={layer}
                fullTraitCount={fullLayer.traits.length}
                expanded={expandedLayerIds.has(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
                saving={saving}
                onWeightChange={updateWeight}
                onBulkWeightChange={bulkUpdateLayerWeights}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function LayerSection({
  layer,
  fullTraitCount,
  expanded,
  onToggle,
  saving,
  onWeightChange,
  onBulkWeightChange,
}) {
  const [bulkWeight, setBulkWeight] = useState(String(DEFAULT_TRAIT_WEIGHT));
  const isBulkSaving = saving === `bulk-${layer.id}`;

  return (
    <div className="bezel-outer">
      <div className="bezel-inner overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-zinc-800/30 transition-colors"
          aria-expanded={expanded}
        >
          <CaretDown
            size={18}
            className={`shrink-0 text-zinc-500 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-white truncate">{layer.name}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {layer.traits.length}
              {fullTraitCount !== layer.traits.length
                ? ` of ${fullTraitCount} traits shown`
                : ` traits`}
              {" · "}total weight {layer.totalWeight}
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-zinc-600">
            {expanded ? "Collapse" : "Expand"}
          </span>
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-800/80 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-zinc-500">Set all weights in layer</label>
              <input
                type="number"
                min="1"
                value={bulkWeight}
                onChange={(e) => setBulkWeight(e.target.value)}
                disabled={isBulkSaving}
                className="w-16 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white"
              />
              <button
                type="button"
                disabled={isBulkSaving || !layer.traits.length}
                onClick={() => onBulkWeightChange(layer.id, bulkWeight)}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
              >
                {isBulkSaving ? "Saving…" : "Apply to all"}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {layer.traits.map((trait) => (
                <TraitCard
                  key={trait.id}
                  trait={trait}
                  saving={saving === trait.id}
                  onWeightChange={(w) => onWeightChange(trait.id, w)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
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
