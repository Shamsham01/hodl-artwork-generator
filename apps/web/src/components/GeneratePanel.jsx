import { useEffect, useState } from "react";
import {
  Play,
  DownloadSimple,
  LinkSimple,
  ChartBar,
  CheckCircle,
  ArrowsClockwise,
  Warning,
} from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useGenerationPayment } from "../hooks/useGenerationPayment";

export default function GeneratePanel({ projectId, project, onUpdate }) {
  const [editionSize, setEditionSize] = useState(project?.edition_size || 100);
  const [configs, setConfigs] = useState([]);
  const [job, setJob] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const [downloading, setDownloading] = useState(false);

  const [baseUri, setBaseUri] = useState(project?.base_uri || "");
  const [updatingUri, setUpdatingUri] = useState(false);
  const [uriUpdated, setUriUpdated] = useState(false);

  const [rarity, setRarity] = useState(null);
  const [loadingRarity, setLoadingRarity] = useState(false);

  const [results, setResults] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [paying, setPaying] = useState(false);

  const { paymentDisabled, getCharge, payForEditions } = useGenerationPayment();

  const LIVE_PREVIEW_LIMIT = 10;
  const livePreview = job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (project?.edition_size) setEditionSize(project.edition_size);
    if (project?.base_uri) setBaseUri(project.base_uri);
  }, [project]);

  // Restore the most recent job so progress / download / update-URI survive
  // switching tabs (the component unmounts and loses local state otherwise).
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("generation_jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active && data) setJob(data);

      const { data: cfg } = await supabase
        .from("layer_configurations")
        .select("id, label, edition_count, sort_order")
        .eq("project_id", projectId)
        .order("sort_order");
      if (active) setConfigs(cfg || []);
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const hasConfigs = configs.length > 0;
  const configTotal = configs.reduce((sum, c) => sum + (c.edition_count || 0), 0);
  const effectiveSize = hasConfigs ? configTotal : editionSize;
  const generationCharge = getCharge(effectiveSize);
  const busy = job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (!job?.id) return;

    const channel = supabase
      .channel(`job-${job.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "generation_jobs",
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          setJob(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job?.id]);

  async function collectGenerationPayment() {
    setPaying(true);
    try {
      return await payForEditions(effectiveSize);
    } finally {
      setPaying(false);
    }
  }

  async function startGeneration() {
    setGenerating(true);
    setError(null);
    setRarity(null);
    try {
      const paymentTxHash = await collectGenerationPayment();

      await supabase
        .from("projects")
        .update({
          edition_size: effectiveSize,
          name_prefix: project.name_prefix,
          base_uri: project.base_uri,
        })
        .eq("id", projectId);

      // If a previous (failed) job exists, clear its partial output first.
      const result = job
        ? await api.regenerate(projectId, effectiveSize, paymentTxHash)
        : await api.generate(projectId, effectiveSize, paymentTxHash);
      setJob(result.job);
      setResults([]);
      onUpdate?.();
    } catch (err) {
      const msg = err?.message || String(err);
      if (/user rejected|cancelled|canceled|denied/i.test(msg)) {
        setError("Payment cancelled.");
      } else {
        setError(msg);
      }
    }
    setGenerating(false);
  }

  async function handleDownload() {
    if (!job?.id) return;
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await api.downloadJob(job.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "collection.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
    setDownloading(false);
  }

  async function handleUpdateUri() {
    if (!job?.id) return;
    setUpdatingUri(true);
    setUriUpdated(false);
    setError(null);
    try {
      await api.updateUri(job.id, { baseUri });
      setUriUpdated(true);
      onUpdate?.();
    } catch (err) {
      setError(err.message);
    }
    setUpdatingUri(false);
  }

  async function loadRarity() {
    if (!job?.id) return;
    setLoadingRarity(true);
    setError(null);
    try {
      const result = await api.rarity(job.id);
      setRarity(result);
    } catch (err) {
      setError(err.message);
    }
    setLoadingRarity(false);
  }

  // During generation only: fetch the 10 most recent WebP thumbs (no full PNGs).
  async function fetchLivePreview() {
    if (!job?.id) return;
    setLoadingResults(true);
    try {
      const { editions } = await api.getEditions(job.id, {
        limit: LIVE_PREVIEW_LIMIT,
        latest: true,
        thumbsOnly: true,
      });
      setResults(editions);
    } catch {
      // ignore transient errors while generating
    }
    setLoadingResults(false);
  }

  useEffect(() => {
    if (!job?.id || !livePreview) {
      if (job?.status === "complete") setResults([]);
      return;
    }
    fetchLivePreview();
    const id = setInterval(fetchLivePreview, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.progress, livePreview]);

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const paymentTxHash = await collectGenerationPayment();

      await supabase
        .from("projects")
        .update({ edition_size: effectiveSize })
        .eq("id", projectId);
      const result = await api.regenerate(
        projectId,
        effectiveSize,
        paymentTxHash
      );
      setJob(result.job);
      setResults([]);
      setRarity(null);
      setConfirmRegen(false);
      onUpdate?.();
    } catch (err) {
      const msg = err?.message || String(err);
      if (/user rejected|cancelled|canceled|denied/i.test(msg)) {
        setError("Payment cancelled.");
      } else {
        setError(msg);
      }
    }
    setRegenerating(false);
  }

  const paymentBusy = paying;
  const actionBusy = generating || regenerating || paymentBusy;

  const progress = job ? Math.round((job.progress / job.edition_size) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="bezel-outer">
        <div className="bezel-inner p-8 space-y-6">
          {hasConfigs ? (
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Edition size</label>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-white">{configTotal}</span>
                <span className="text-xs text-zinc-500">
                  total across {configs.length} configuration
                  {configs.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {configs.map((c, i) => (
                  <span
                    key={c.id}
                    className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400"
                  >
                    {c.label || `Character ${i + 1}`}: {c.edition_count}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-zinc-600 mt-2">
                Adjust per-character counts and layers in the Layers tab.
              </p>
            </div>
          ) : (
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Edition size</label>
              <input
                type="number"
                min="1"
                max="10000"
                value={editionSize}
                onChange={(e) => setEditionSize(parseInt(e.target.value, 10) || 1)}
                disabled={busy}
                className="w-full max-w-xs bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-white"
              />
            </div>
          )}

          {!paymentDisabled && (
            <p className="text-xs text-zinc-500">
              Generation fee:{" "}
              <span className="text-zinc-300">
                {generationCharge.displayAmount}
              </span>{" "}
              ({generationCharge.buckets} × 100 editions @ 0.5 USDC). Paid to
              HODL Token Club treasury via wallet on Generate / Re-generate.
            </p>
          )}

          {!job || job.status === "failed" ? (
            <button
              onClick={startGeneration}
              disabled={actionBusy}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <Play size={18} weight="bold" />
              {paymentBusy
                ? `Confirm ${generationCharge.displayAmount} in wallet…`
                : generating
                  ? "Starting..."
                  : `Generate collection (${generationCharge.displayAmount})`}
            </button>
          ) : job.status === "complete" ? (
            <div className="space-y-4">
              <p className="inline-flex items-center gap-2 text-emerald-400 text-sm font-medium">
                <CheckCircle size={18} weight="fill" />
                Generation complete: {job.progress} editions
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <DownloadSimple size={18} weight="bold" />
                  {downloading ? "Preparing zip..." : "Download collection (.zip)"}
                </button>
                <button
                  onClick={() => setConfirmRegen(true)}
                  disabled={actionBusy}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors disabled:opacity-50"
                >
                  <ArrowsClockwise size={18} weight="bold" />
                  Re-generate
                </button>
              </div>
              <p className="text-[11px] text-zinc-600">
                Full-resolution PNGs and JSON metadata packaged in one zip — browse locally after download.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">
                  {job.status === "queued" ? "Queued..." : "Generating..."}
                </span>
                <span className="text-white">
                  {job.progress} / {job.edition_size}
                </span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          {job?.error_message && (
            <p className="text-sm text-red-400">{job.error_message}</p>
          )}
        </div>
      </div>

      {livePreview && (
        <div className="bezel-outer">
          <div className="bezel-inner p-8 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Live preview</h3>
              <p className="text-xs text-zinc-500 mt-1">
                Latest {LIVE_PREVIEW_LIMIT} editions while generating — small WebP previews only.
                Download the full collection when complete to browse every piece locally.
              </p>
            </div>

            {results.length === 0 ? (
              <p className="text-sm text-zinc-600 py-8 text-center">
                {loadingResults
                  ? "Loading preview…"
                  : "Previews appear here as editions are rendered."}
              </p>
            ) : (
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                {results.map((r) => (
                  <div
                    key={r.edition}
                    className="group relative aspect-square rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800"
                  >
                    {r.url ? (
                      <img
                        src={r.url}
                        alt={r.name}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full animate-pulse" />
                    )}
                    <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-zinc-200">
                      #{r.edition}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {job?.status === "complete" && (
        <>
          <div className="bezel-outer">
            <div className="bezel-inner p-8 space-y-4">
              <div className="flex items-center gap-2">
                <LinkSimple size={18} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Update IPFS / base URI
                </h3>
              </div>
              <p className="text-xs text-zinc-500">
                Replace the placeholder URI after you've pinned your images to
                IPFS. Every metadata JSON's <code className="text-zinc-400">image</code>{" "}
                field is rewritten to{" "}
                <code className="text-zinc-400">{"{baseUri}/{edition}.png"}</code>.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={baseUri}
                  onChange={(e) => {
                    setBaseUri(e.target.value);
                    setUriUpdated(false);
                  }}
                  placeholder="ipfs://YourRealCID"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                />
                <button
                  onClick={handleUpdateUri}
                  disabled={updatingUri || !baseUri}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-800 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-all disabled:opacity-50"
                >
                  {updatingUri ? "Updating..." : "Update metadata"}
                </button>
              </div>
              {uriUpdated && (
                <p className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                  <CheckCircle size={16} weight="fill" />
                  Metadata updated. Re-download to get the new files.
                </p>
              )}
            </div>
          </div>

          <div className="bezel-outer">
            <div className="bezel-inner p-8 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChartBar size={18} className="text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">Rarity report</h3>
                </div>
                <button
                  onClick={loadRarity}
                  disabled={loadingRarity}
                  className="text-sm text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                >
                  {loadingRarity ? "Computing..." : rarity ? "Refresh" : "Compute rarity"}
                </button>
              </div>

              {rarity && (
                <div className="space-y-5 pt-2">
                  {rarity.rarity.map((layer) => (
                    <div key={layer.trait_type}>
                      <p className="text-xs font-medium text-zinc-300 mb-2">
                        {layer.trait_type}
                      </p>
                      <div className="space-y-1.5">
                        {layer.values.map((v) => (
                          <div
                            key={v.value}
                            className="flex items-center gap-3 text-xs"
                          >
                            <span className="w-32 truncate text-zinc-400">
                              {v.value}
                            </span>
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500/70"
                                style={{ width: `${v.percentage}%` }}
                              />
                            </div>
                            <span className="w-28 text-right text-zinc-500">
                              {v.count} ({v.percentage}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {confirmRegen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => !regenerating && setConfirmRegen(false)}
        >
          <div
            className="bezel-outer max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bezel-inner p-7 space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-amber-500/10 text-amber-400">
                  <Warning size={20} weight="fill" />
                </span>
                <h3 className="text-lg font-semibold text-white">
                  Re-generate collection
                </h3>
              </div>
              <p className="text-sm text-zinc-400">
                This deletes the current generated editions and their files, then
                creates a brand-new set from your latest layers, rules and
                settings. This keeps the database clean but cannot be undone.
              </p>
              {!paymentDisabled && (
                <p className="text-sm text-zinc-500">
                  Fee for this run:{" "}
                  <span className="text-zinc-300">
                    {generationCharge.displayAmount}
                  </span>{" "}
                  — your wallet will open to confirm payment before
                  re-generation starts.
                </p>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmRegen(false)}
                  disabled={regenerating}
                  className="rounded-full px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={actionBusy}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <ArrowsClockwise size={16} weight="bold" />
                  {paymentBusy
                    ? `Confirm ${generationCharge.displayAmount}…`
                    : regenerating
                      ? "Starting…"
                      : `Pay ${generationCharge.displayAmount} & re-generate`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
