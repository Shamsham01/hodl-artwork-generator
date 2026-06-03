import { useEffect, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";

/** JSONB payload shape per type — avoids stale exclude/include keys in Supabase. */
function cleanPayload(restrictionType, payload = {}, triggerElements) {
  const triggers = triggerElements ?? payload.triggerElements ?? [];
  if (restrictionType === "exclude_layers") {
    return {
      triggerElements: triggers,
      excludeLayers: payload.excludeLayers ?? [],
    };
  }
  if (restrictionType === "include_elements") {
    return {
      triggerElements: triggers,
      includeElements: payload.includeElements ?? {},
    };
  }
  return {
    triggerElements: triggers,
    excludeElements: payload.excludeElements ?? {},
  };
}

export default function RestrictionEditor({ projectId }) {
  const [restrictions, setRestrictions] = useState([]);
  const [layers, setLayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    loadData();
  }, [projectId]);

  async function loadData() {
    const { data: layerData } = await supabase
      .from("project_layers")
      .select("id, name")
      .eq("project_id", projectId)
      .order("sort_order");

    const { data: traitData } = await supabase
      .from("traits")
      .select("layer_id, name")
      .in("layer_id", (layerData || []).map((l) => l.id));

    const layersWithTraits = (layerData || []).map((l) => ({
      ...l,
      traits: (traitData || []).filter((t) => t.layer_id === l.id).map((t) => t.name),
    }));

    const { data: restrictionData } = await supabase
      .from("layer_restrictions")
      .select("*")
      .eq("project_id", projectId);

    setLayers(layersWithTraits);
    setRestrictions(restrictionData || []);
    setLoading(false);
  }

  async function addRule() {
    const firstTrait = layers[0]?.traits[0] || "";
    const { data } = await supabase
      .from("layer_restrictions")
      .insert({
        project_id: projectId,
        trigger_layer: layers[0]?.name || "",
        trigger_element: firstTrait,
        restriction_type: "exclude_layers",
        payload: {
          excludeLayers: [],
          triggerElements: firstTrait ? [firstTrait] : [],
        },
      })
      .select()
      .single();

    if (data) setRestrictions((prev) => [...prev, data]);
  }

  async function updateRule(id, updates) {
    setSaveError(null);
    const existing = restrictions.find((r) => r.id === id);
    const restrictionType = updates.restriction_type ?? existing?.restriction_type;
    const nextPayload =
      updates.payload !== undefined
        ? cleanPayload(
            restrictionType,
            { ...existing?.payload, ...updates.payload },
            updates.payload?.triggerElements ?? existing?.payload?.triggerElements
          )
        : undefined;

    const row = {
      ...updates,
      ...(nextPayload !== undefined ? { payload: nextPayload } : {}),
    };

    const { data, error } = await supabase
      .from("layer_restrictions")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      setSaveError(
        error.message.includes("layer_restrictions_restriction_type_check")
          ? "Could not save: run the latest Supabase migration (include_elements), then try again."
          : error.message
      );
      return;
    }

    if (data) {
      setRestrictions((prev) => prev.map((r) => (r.id === id ? data : r)));
    }
  }

  async function deleteRule(id) {
    await supabase.from("layer_restrictions").delete().eq("id", id);
    setRestrictions((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) return <div className="animate-pulse h-32 bg-zinc-800/30 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-zinc-400">
          One-way rules: when green trigger traits match, apply exclude or include on
          another layer. No effect on other combinations.
        </p>
        <button
          onClick={addRule}
          className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
        >
          <Plus size={16} />
          Add rule
        </button>
      </div>

      {saveError && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {saveError}
        </p>
      )}

      {restrictions.length === 0 ? (
        <p className="text-sm text-zinc-600 text-center py-6">No restrictions defined</p>
      ) : (
        restrictions.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            layers={layers}
            onUpdate={(updates) => updateRule(rule.id, updates)}
            onDelete={() => deleteRule(rule.id)}
          />
        ))
      )}
    </div>
  );
}

function RuleCard({ rule, layers, onUpdate, onDelete }) {
  const triggerLayer = layers.find((l) => l.name === rule.trigger_layer);
  const isExcludeLayers = rule.restriction_type === "exclude_layers";
  const isIncludeElements = rule.restriction_type === "include_elements";

  const triggerTraits = triggerLayer?.traits || [];
  const selectedTriggers = Array.isArray(rule.payload?.triggerElements)
    ? rule.payload.triggerElements
    : rule.trigger_element
    ? [rule.trigger_element]
    : [];
  const allSelected =
    triggerTraits.length > 0 && selectedTriggers.length === triggerTraits.length;

  function mergePayload(partial) {
    return cleanPayload(rule.restriction_type, { ...rule.payload, ...partial }, partial.triggerElements);
  }

  function setTriggers(next) {
    onUpdate({
      trigger_element: next[0] || "",
      payload: mergePayload({ triggerElements: next }),
    });
  }

  function toggleTrigger(trait) {
    const next = selectedTriggers.includes(trait)
      ? selectedTriggers.filter((t) => t !== trait)
      : [...selectedTriggers, trait];
    setTriggers(next);
  }

  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-4 space-y-3">
        <div className="flex items-center justify-between">
          <select
            value={rule.restriction_type}
            onChange={(e) => {
              const type = e.target.value;
              const payload = cleanPayload(type, rule.payload, selectedTriggers);
              onUpdate({ restriction_type: type, payload });
            }}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="exclude_layers">Exclude entire layers</option>
            <option value="exclude_elements">Exclude specific traits</option>
            <option value="include_elements">Include specific traits only</option>
          </select>
          <button onClick={onDelete} className="text-zinc-500 hover:text-red-400">
            <Trash size={18} />
          </button>
        </div>

        <div>
          <label className="text-xs text-zinc-500 block mb-1">When layer</label>
          <select
            value={rule.trigger_layer}
            onChange={(e) =>
              onUpdate({
                trigger_layer: e.target.value,
                trigger_element: "",
                payload: mergePayload({ triggerElements: [] }),
              })
            }
            className="w-full sm:max-w-xs bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            {layers.map((l) => (
              <option key={l.id} value={l.name}>{l.name}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-zinc-500">
              Has any of these traits
            </label>
            <button
              onClick={() =>
                setTriggers(allSelected ? [] : [...triggerTraits])
              }
              className="text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {triggerTraits.length === 0 ? (
              <span className="text-xs text-zinc-600">No traits in this layer</span>
            ) : (
              triggerTraits.map((t) => {
                const checked = selectedTriggers.includes(t);
                return (
                  <label
                    key={t}
                    className={`flex items-center gap-1.5 text-xs cursor-pointer rounded-full border px-2.5 py-1 transition-colors ${
                      checked
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTrigger(t)}
                      className="sr-only"
                    />
                    {t}
                  </label>
                );
              })
            )}
          </div>
        </div>

        {isExcludeLayers ? (
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Exclude layers</label>
            <div className="flex flex-wrap gap-2">
              {layers.map((l) => {
                const excluded = rule.payload?.excludeLayers || [];
                const checked = excluded.includes(l.name);
                return (
                  <label key={l.id} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? excluded.filter((x) => x !== l.name)
                          : [...excluded, l.name];
                        onUpdate({ payload: mergePayload({ excludeLayers: next }) });
                      }}
                      className="rounded border-zinc-600"
                    />
                    {l.name}
                  </label>
                );
              })}
            </div>
          </div>
        ) : isIncludeElements ? (
          <IncludeElementsEditor
            rule={rule}
            layers={layers}
            mergePayload={mergePayload}
            onUpdate={onUpdate}
          />
        ) : (
          <ExcludeElementsEditor
            rule={rule}
            layers={layers}
            mergePayload={mergePayload}
            onUpdate={onUpdate}
          />
        )}
      </div>
    </div>
  );
}

function ExcludeElementsEditor({ rule, layers, mergePayload, onUpdate }) {
  const excludeElements = rule.payload?.excludeElements || {};
  const affectedLayer = Object.keys(excludeElements)[0] || layers[0]?.name;
  const excludedTraits = excludeElements[affectedLayer] || [];
  const layer = layers.find((l) => l.name === affectedLayer);
  const allChecked =
    (layer?.traits || []).length > 0 &&
    excludedTraits.length === (layer?.traits || []).length;

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs text-zinc-500 block mb-1">In layer</label>
        <select
          value={affectedLayer}
          onChange={(e) =>
            onUpdate({
              payload: mergePayload({ excludeElements: { [e.target.value]: [] } }),
            })
          }
          className="w-full sm:max-w-xs bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {layers.map((l) => (
            <option key={l.id} value={l.name}>{l.name}</option>
          ))}
        </select>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-zinc-500">Exclude traits</label>
          <button
            onClick={() =>
              onUpdate({
                payload: mergePayload({
                  excludeElements: {
                    [affectedLayer]: allChecked ? [] : [...(layer?.traits || [])],
                  },
                }),
              })
            }
            className="text-[11px] text-emerald-400 hover:text-emerald-300"
          >
            {allChecked ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(layer?.traits || []).map((t) => {
            const checked = excludedTraits.includes(t);
            return (
              <label key={t} className="flex items-center gap-1.5 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? excludedTraits.filter((x) => x !== t)
                      : [...excludedTraits, t];
                    onUpdate({
                      payload: mergePayload({
                        excludeElements: { [affectedLayer]: next },
                      }),
                    });
                  }}
                  className="rounded border-zinc-600"
                />
                {t}
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          When trigger matches: checked traits are blocked. When it does not match,
          this rule does nothing (any trait allowed).
        </p>
      </div>
    </div>
  );
}

function IncludeElementsEditor({ rule, layers, mergePayload, onUpdate }) {
  const includeElements = rule.payload?.includeElements || {};
  const affectedLayer = Object.keys(includeElements)[0] || layers[0]?.name;
  const includedTraits = includeElements[affectedLayer] || [];
  const layer = layers.find((l) => l.name === affectedLayer);
  const allChecked =
    (layer?.traits || []).length > 0 &&
    includedTraits.length === (layer?.traits || []).length;

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs text-zinc-500 block mb-1">In layer</label>
        <select
          value={affectedLayer}
          onChange={(e) =>
            onUpdate({
              payload: mergePayload({ includeElements: { [e.target.value]: [] } }),
            })
          }
          className="w-full sm:max-w-xs bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {layers.map((l) => (
            <option key={l.id} value={l.name}>{l.name}</option>
          ))}
        </select>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-zinc-500">Allow only these traits</label>
          <button
            onClick={() =>
              onUpdate({
                payload: mergePayload({
                  includeElements: {
                    [affectedLayer]: allChecked ? [] : [...(layer?.traits || [])],
                  },
                }),
              })
            }
            className="text-[11px] text-emerald-400 hover:text-emerald-300"
          >
            {allChecked ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(layer?.traits || []).map((t) => {
            const checked = includedTraits.includes(t);
            return (
              <label
                key={t}
                className={`flex items-center gap-1.5 text-xs cursor-pointer rounded-full border px-2.5 py-1 transition-colors ${
                  checked
                    ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? includedTraits.filter((x) => x !== t)
                      : [...includedTraits, t];
                    onUpdate({
                      payload: mergePayload({
                        includeElements: { [affectedLayer]: next },
                      }),
                    });
                  }}
                  className="sr-only"
                />
                {t}
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          When trigger matches: only checked traits can appear in this layer (e.g.
          Alien backgrounds → only Alien skins). When it does not match, this rule
          does nothing.
        </p>
      </div>
    </div>
  );
}
