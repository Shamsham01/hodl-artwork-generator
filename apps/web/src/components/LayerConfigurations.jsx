import { useEffect, useState } from "react";
import {
  Plus,
  Trash,
  ArrowUp,
  ArrowDown,
  X,
  Stack,
  CheckCircle,
  DotsSixVertical,
} from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";

export default function LayerConfigurations({ projectId }) {
  const [availableLayers, setAvailableLayers] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load();
  }, [projectId]);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function load() {
    const { data: layerData } = await supabase
      .from("project_layers")
      .select("id, name, sort_order")
      .eq("project_id", projectId)
      .order("sort_order");

    const layerNames = (layerData || []).map((l) => l.name);
    setAvailableLayers(layerNames);

    const { data: configData } = await supabase
      .from("layer_configurations")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    let list = configData || [];

    // Seed a default configuration (all layers) the first time, so existing
    // single-character projects keep working with no extra clicks.
    if (list.length === 0 && layerNames.length > 0) {
      const { data: project } = await supabase
        .from("projects")
        .select("edition_size")
        .eq("id", projectId)
        .single();

      const { data: created } = await supabase
        .from("layer_configurations")
        .insert({
          project_id: projectId,
          sort_order: 0,
          label: "Character 1",
          edition_count: project?.edition_size || 100,
          layers_order: layerNames.map((name) => ({ name })),
        })
        .select()
        .single();

      if (created) list = [created];
    }

    setConfigs(list);
    setLoading(false);
  }

  async function addConfig() {
    const { data } = await supabase
      .from("layer_configurations")
      .insert({
        project_id: projectId,
        sort_order: configs.length,
        label: `Character ${configs.length + 1}`,
        edition_count: 100,
        layers_order: availableLayers.map((name) => ({ name })),
      })
      .select()
      .single();
    if (data) setConfigs((prev) => [...prev, data]);
  }

  async function updateConfig(id, updates) {
    setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    await supabase.from("layer_configurations").update(updates).eq("id", id);
    flashSaved();
  }

  async function deleteConfig(id) {
    const remaining = configs.filter((c) => c.id !== id);
    setConfigs(remaining);
    await supabase.from("layer_configurations").delete().eq("id", id);
    await Promise.all(
      remaining.map((c, i) =>
        supabase.from("layer_configurations").update({ sort_order: i }).eq("id", c.id)
      )
    );
    flashSaved();
  }

  if (loading) {
    return <div className="animate-pulse h-48 bg-zinc-800/30 rounded-2xl" />;
  }

  if (!availableLayers.length) {
    return (
      <p className="text-sm text-zinc-500 text-center py-8">
        Upload layers first, then define your configurations
      </p>
    );
  }

  const total = configs.reduce((sum, c) => sum + (c.edition_count || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-zinc-400 max-w-xl">
          Each configuration is a separate "character" set: pick its own layers
          (back → front) and how many editions to mint. Configurations are
          minted in order, so editions 1–N use the first, the next batch uses
          the second, and so on.
        </p>
        <div className="text-right shrink-0">
          <p className="text-xs text-zinc-500">Total editions</p>
          <p className="text-lg font-semibold text-white">{total}</p>
          {saved && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
              <CheckCircle size={12} weight="fill" />
              Saved
            </span>
          )}
        </div>
      </div>

      {configs.map((config, index) => (
        <ConfigCard
          key={config.id}
          index={index}
          config={config}
          availableLayers={availableLayers}
          canDelete={configs.length > 1}
          onUpdate={(updates) => updateConfig(config.id, updates)}
          onDelete={() => deleteConfig(config.id)}
        />
      ))}

      <button
        onClick={addConfig}
        className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
      >
        <Plus size={16} weight="bold" />
        Add configuration
      </button>
    </div>
  );
}

function ConfigCard({ index, config, availableLayers, canDelete, onUpdate, onDelete }) {
  const order = Array.isArray(config.layers_order) ? config.layers_order : [];
  const includedNames = order.map((o) => (typeof o === "string" ? o : o.name));
  const notIncluded = availableLayers.filter((n) => !includedNames.includes(n));
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  function setOrder(names) {
    onUpdate({ layers_order: names.map((name) => ({ name })) });
  }

  function reorderLayers(from, to) {
    if (from === to || from < 0 || to < 0 || from >= includedNames.length || to >= includedNames.length) {
      return;
    }
    const next = [...includedNames];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
  }

  function moveLayer(from, to) {
    reorderLayers(from, to);
  }

  function handleDragStart(e, i) {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  }

  function handleDragOver(e, i) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex !== null && i !== dragIndex) setOverIndex(i);
  }

  function handleDrop(e, i) {
    e.preventDefault();
    const from =
      dragIndex ?? parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!Number.isNaN(from)) reorderLayers(from, i);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-400 shrink-0">
            <Stack size={16} weight="bold" />
          </span>
          <input
            value={config.label || ""}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder={`Character ${index + 1}`}
            className="flex-1 bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-emerald-500/50 focus:outline-none text-sm font-medium text-white py-1 transition-colors"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Editions</label>
            <input
              type="number"
              min="1"
              value={config.edition_count}
              onChange={(e) =>
                onUpdate({ edition_count: parseInt(e.target.value, 10) || 0 })
              }
              className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white"
            />
          </div>
          {canDelete && (
            <button
              onClick={onDelete}
              className="text-zinc-500 hover:text-red-400 transition-colors"
              title="Delete configuration"
            >
              <Trash size={18} />
            </button>
          )}
        </div>

        <div>
          <label className="text-xs text-zinc-500 block mb-2">
            Layers (top = back, bottom = front) — drag to reorder
          </label>
          {includedNames.length === 0 ? (
            <p className="text-xs text-zinc-600 py-2">No layers selected yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {includedNames.map((name, i) => (
                <li
                  key={name}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  className={`flex items-center gap-2 rounded-lg bg-zinc-900/60 border px-3 py-2 transition-colors ${
                    dragIndex === i
                      ? "opacity-40 border-zinc-800"
                      : overIndex === i
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragEnd={handleDragEnd}
                    className="cursor-grab active:cursor-grabbing touch-none text-zinc-600 hover:text-zinc-400 shrink-0 p-0.5 -ml-0.5"
                    aria-label={`Drag to reorder ${name}`}
                  >
                    <DotsSixVertical size={16} weight="bold" />
                  </button>
                  <span className="text-xs text-zinc-600 w-5">{i + 1}</span>
                  <span className="flex-1 text-sm text-white">{name}</span>
                  <span className="text-[10px] text-zinc-600 w-8 text-right">
                    {i === 0 ? "back" : i === includedNames.length - 1 ? "front" : ""}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => moveLayer(i, i - 1)}
                      disabled={i === 0}
                      className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
                      aria-label="Move up"
                    >
                      <ArrowUp size={12} weight="bold" />
                    </button>
                    <button
                      onClick={() => moveLayer(i, i + 1)}
                      disabled={i === includedNames.length - 1}
                      className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
                      aria-label="Move down"
                    >
                      <ArrowDown size={12} weight="bold" />
                    </button>
                    <button
                      onClick={() => setOrder(includedNames.filter((n) => n !== name))}
                      className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors"
                      aria-label="Remove layer"
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {notIncluded.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-zinc-600 mb-1.5">Add layers</p>
              <div className="flex flex-wrap gap-2">
                {notIncluded.map((name) => (
                  <button
                    key={name}
                    onClick={() => setOrder([...includedNames, name])}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
                  >
                    <Plus size={12} weight="bold" />
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
