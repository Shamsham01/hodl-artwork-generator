import { useEffect, useState } from "react";
import { FloppyDisk, CheckCircle } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";

const DEFAULT_GEN = {
  smoothing: false,
  shuffleLayerConfigurations: false,
  uniqueDnaTorrance: 10000,
  rarityDelimiter: "#",
  background: {
    generate: true,
    static: false,
    brightness: "80%",
    default: "#000000",
  },
  text: {
    only: false,
    color: "#ffffff",
    size: 20,
    xGap: 40,
    yGap: 40,
    align: "left",
    baseline: "top",
    weight: "regular",
    family: "Courier",
    spacer: " => ",
  },
};

function mergeGen(gen) {
  return {
    ...DEFAULT_GEN,
    ...gen,
    background: { ...DEFAULT_GEN.background, ...(gen?.background || {}) },
    text: { ...DEFAULT_GEN.text, ...(gen?.text || {}) },
  };
}

const inputCls =
  "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none transition-colors";

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? "bg-emerald-500" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      <span className="text-sm text-zinc-300">{label}</span>
    </label>
  );
}

function Section({ title, children }) {
  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-6 space-y-5">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function ProjectSettingsPanel({ project, onUpdate }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    name_prefix: "",
    base_uri: "",
    canvas_width: 512,
    canvas_height: 512,
  });
  const [gen, setGen] = useState(mergeGen({}));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name || "",
      description: project.description || "",
      name_prefix: project.name_prefix || "",
      base_uri: project.base_uri || "",
      canvas_width: project.canvas_width || 512,
      canvas_height: project.canvas_height || 512,
    });
    setGen(mergeGen(project.gen_config));
  }, [project]);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }
  function setGenField(key, value) {
    setGen((g) => ({ ...g, [key]: value }));
    setSaved(false);
  }
  function setBg(key, value) {
    setGen((g) => ({ ...g, background: { ...g.background, [key]: value } }));
    setSaved(false);
  }
  function setText(key, value) {
    setGen((g) => ({ ...g, text: { ...g.text, [key]: value } }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("projects")
      .update({
        name: form.name,
        description: form.description,
        name_prefix: form.name_prefix,
        base_uri: form.base_uri,
        canvas_width: parseInt(form.canvas_width, 10) || 512,
        canvas_height: parseInt(form.canvas_height, 10) || 512,
        network: "mvx",
        gen_config: gen,
      })
      .eq("id", project.id);

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSaved(true);
    onUpdate?.();
  }

  return (
    <div className="space-y-5">
      <Section title="Collection metadata">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Collection name" hint="Shown in your dashboard and bundle folder.">
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="My MultiversX Collection"
            />
          </Field>
          <Field label="Name prefix" hint='Each NFT is named "{prefix} #1", "{prefix} #2"...'>
            <input
              className={inputCls}
              value={form.name_prefix}
              onChange={(e) => setField("name_prefix", e.target.value)}
              placeholder="Collection"
            />
          </Field>
        </div>
        <Field label="Collection description" hint="Written into every NFT's metadata JSON.">
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Describe your collection..."
          />
        </Field>
        <Field
          label="Base URI (IPFS)"
          hint="image field becomes {baseUri}/{edition}.png. You can also update this after generating."
        >
          <input
            className={inputCls}
            value={form.base_uri}
            onChange={(e) => setField("base_uri", e.target.value)}
            placeholder="ipfs://NewUriToReplace"
          />
        </Field>
        <Field label="Network">
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
            <CheckCircle size={16} weight="fill" />
            MultiversX
          </div>
        </Field>
      </Section>

      <Section title="Image & output">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Image width (px)">
            <input
              type="number"
              min="1"
              className={inputCls}
              value={form.canvas_width}
              onChange={(e) => setField("canvas_width", e.target.value)}
            />
          </Field>
          <Field label="Image height (px)">
            <input
              type="number"
              min="1"
              className={inputCls}
              value={form.canvas_height}
              onChange={(e) => setField("canvas_height", e.target.value)}
            />
          </Field>
        </div>
        <p className="text-[11px] text-zinc-600">
          Canvas size applies to final collection generation and download. Preview
          on the Preview tab always renders at 512×512 using lightweight trait
          thumbs to save bandwidth.
        </p>
        <Toggle
          label="Image smoothing (anti-aliasing)"
          checked={gen.smoothing}
          onChange={(v) => setGenField("smoothing", v)}
        />
        <p className="text-[11px] text-zinc-600">
          Generation runs in your browser; finished PNGs and metadata are kept
          locally until you download the collection zip from the Generate tab.
        </p>
      </Section>

      <Section title="Background">
        <Toggle
          label="Generate background"
          checked={gen.background.generate}
          onChange={(v) => setBg("generate", v)}
        />
        <Toggle
          label="Static background (use a fixed color)"
          checked={gen.background.static}
          onChange={(v) => setBg("static", v)}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Random brightness" hint="Used when background is not static, e.g. 80%.">
            <input
              className={inputCls}
              value={gen.background.brightness}
              onChange={(e) => setBg("brightness", e.target.value)}
              placeholder="80%"
            />
          </Field>
          <Field label="Default color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={gen.background.default}
                onChange={(e) => setBg("default", e.target.value)}
                className="h-9 w-12 rounded border border-zinc-700 bg-zinc-900"
              />
              <input
                className={inputCls}
                value={gen.background.default}
                onChange={(e) => setBg("default", e.target.value)}
              />
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Text overlay">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Optional debug mode. When enabled, each layer is drawn as text (layer
          name and trait name) instead of artwork — useful for checking layer
          order, not for normal NFT output. Leave off for real images.
        </p>
        <Toggle
          label="Render text labels only (no art)"
          checked={gen.text.only}
          onChange={(v) => setText("only", v)}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Font family">
            <input
              className={inputCls}
              value={gen.text.family}
              onChange={(e) => setText("family", e.target.value)}
            />
          </Field>
          <Field label="Font size (pt)">
            <input
              type="number"
              className={inputCls}
              value={gen.text.size}
              onChange={(e) => setText("size", parseInt(e.target.value, 10) || 0)}
            />
          </Field>
          <Field label="Text color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={gen.text.color}
                onChange={(e) => setText("color", e.target.value)}
                className="h-9 w-12 rounded border border-zinc-700 bg-zinc-900"
              />
              <input
                className={inputCls}
                value={gen.text.color}
                onChange={(e) => setText("color", e.target.value)}
              />
            </div>
          </Field>
          <Field label="Weight">
            <select
              className={inputCls}
              value={gen.text.weight}
              onChange={(e) => setText("weight", e.target.value)}
            >
              <option value="regular">regular</option>
              <option value="bold">bold</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Advanced">
        <Toggle
          label="Shuffle edition order"
          checked={gen.shuffleLayerConfigurations}
          onChange={(v) => setGenField("shuffleLayerConfigurations", v)}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="Unique DNA tolerance"
            hint="How many duplicate attempts before giving up."
          >
            <input
              type="number"
              className={inputCls}
              value={gen.uniqueDnaTorrance}
              onChange={(e) =>
                setGenField("uniqueDnaTorrance", parseInt(e.target.value, 10) || 0)
              }
            />
          </Field>
          <Field label="Rarity delimiter" hint="Character in filenames before the weight, e.g. Red#20.png">
            <input
              className={inputCls}
              value={gen.rarityDelimiter}
              onChange={(e) => setGenField("rarityDelimiter", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          <FloppyDisk size={18} weight="bold" />
          {saving ? "Saving..." : "Save settings"}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
            <CheckCircle size={16} weight="fill" />
            Saved
          </span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}
