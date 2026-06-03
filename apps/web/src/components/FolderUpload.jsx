import { useCallback, useRef, useState } from "react";
import { UploadSimple, CheckCircle, Warning } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

function parseRelativePath(relativePath) {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const layersIdx = parts.findIndex((p) => p.toLowerCase() === "layers");
  if (layersIdx === -1) return null;

  const layerName = parts[layersIdx + 1];
  const filename = parts[parts.length - 1];
  if (!layerName || !filename.match(/\.(png|jpg|jpeg|gif)$/i)) return null;
  if (filename.includes("-")) return { error: `Dashes not allowed: ${filename}` };

  return { layerName: layerName.toUpperCase(), filename };
}

export default function FolderUpload({ projectId, onComplete }) {
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState(false);

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList);
      const parsed = [];
      const parseErrors = [];

      for (const file of files) {
        const rel = file.webkitRelativePath || file.name;
        const result = parseRelativePath(rel);
        if (!result) continue;
        if (result.error) {
          parseErrors.push(result.error);
          continue;
        }
        parsed.push({ file, ...result });
      }

      if (parseErrors.length) {
        setErrors(parseErrors);
        return;
      }

      if (!parsed.length) {
        setErrors(["No valid layer files found. Upload a folder with layers/LAYER_NAME/*.png structure."]);
        return;
      }

      setUploading(true);
      setErrors([]);
      setProgress({ done: 0, total: parsed.length });

      const uploadedTraits = [];

      for (let i = 0; i < parsed.length; i++) {
        const { file, layerName, filename } = parsed[i];
        const storagePath = `${user.id}/${projectId}/layers/${layerName}/${filename}`;

        const { error } = await supabase.storage
          .from("layer-assets")
          .upload(storagePath, file, { upsert: true });

        if (error) {
          parseErrors.push(`Failed to upload ${filename}: ${error.message}`);
        } else {
          const weightMatch = filename.match(/#(\d+)/);
          uploadedTraits.push({
            layerName,
            filename,
            storagePath,
            weight: weightMatch ? parseInt(weightMatch[1], 10) : 100,
          });
        }

        setProgress({ done: i + 1, total: parsed.length });
      }

      if (uploadedTraits.length) {
        try {
          await api.syncTraits(projectId, uploadedTraits);
          setSuccess(true);
          onComplete?.();
        } catch (err) {
          parseErrors.push(err.message);
        }
      }

      if (parseErrors.length) setErrors(parseErrors);
      setUploading(false);
    },
    [projectId, user, onComplete]
  );

  return (
    <div className="bezel-outer">
      <div className="bezel-inner p-8">
        <input
          ref={inputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {success ? (
          <div className="text-center py-8">
            <CheckCircle size={48} weight="light" className="mx-auto text-emerald-400 mb-3" />
            <p className="text-white font-medium">Layers uploaded successfully</p>
            <p className="text-sm text-zinc-500 mt-1">Traits synced to your project</p>
          </div>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full py-12 border-2 border-dashed border-zinc-700 rounded-xl hover:border-emerald-500/40 transition-colors duration-300 flex flex-col items-center gap-3 disabled:opacity-50"
          >
            <UploadSimple size={32} weight="light" className="text-zinc-500" />
            <span className="text-sm text-zinc-400">
              {uploading
                ? `Uploading ${progress.done}/${progress.total}...`
                : "Drop layers folder or click to browse"}
            </span>
            <span className="text-xs text-zinc-600">Expected: layers/BACKGROUND/*.png</span>
          </button>
        )}

        {errors.length > 0 && (
          <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 text-red-400 text-sm font-medium mb-2">
              <Warning size={16} />
              Upload issues
            </div>
            <ul className="text-xs text-red-300/80 space-y-1">
              {errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {errors.length > 5 && <li>...and {errors.length - 5} more</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
