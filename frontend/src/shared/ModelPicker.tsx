import { Bot, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../types/domain";

type ModelTone = "openai" | "anthropic" | "google" | "doubao" | "qwen" | "glm" | "generic";

const LOBE_ICON_BASE = "https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons";

const providerIcons: Partial<Record<ModelTone, string>> = {
  openai: `${LOBE_ICON_BASE}/openai.svg`,
  anthropic: `${LOBE_ICON_BASE}/claude-color.svg`,
  google: `${LOBE_ICON_BASE}/gemini-color.svg`,
  doubao: `${LOBE_ICON_BASE}/doubao-color.svg`,
  qwen: `${LOBE_ICON_BASE}/qwen-color.svg`,
  glm: `${LOBE_ICON_BASE}/chatglm-color.svg`
};

function modelTone(model: ModelInfo): ModelTone {
  const value = `${model.id} ${model.name} ${model.modelName}`.toLowerCase();
  if (/gpt|openai|\bo[134](?:-|\b)/.test(value)) return "openai";
  if (/claude|anthropic/.test(value)) return "anthropic";
  if (/gemini|google/.test(value)) return "google";
  if (/doubao|豆包/.test(value)) return "doubao";
  if (/qwen|通义/.test(value)) return "qwen";
  if (/glm|智谱/.test(value)) return "glm";
  return "generic";
}

export function ModelProviderBadge({ model }: { model: ModelInfo }) {
  const tone = modelTone(model);
  const iconUrl = model.iconUrl || providerIcons[tone];
  if (iconUrl) return <span className={`model-provider-badge ${tone}`}><img src={iconUrl} alt="" loading="lazy" /></span>;
  return <span className={`model-provider-badge ${tone}`} aria-hidden="true"><Bot /></span>;
}

export function ModelPicker({ models, value, onChange, ariaLabel = "选择模型", getMeta, className = "" }: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  getMeta?: (model: ModelInfo) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find((model) => model.id === value) || models[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!selected) return null;

  return (
    <div ref={rootRef} className={`model-picker ${open ? "open" : ""} ${className}`}>
      <button type="button" className="model-picker-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ModelProviderBadge model={selected} />
        <span><strong>{selected.name}</strong>{getMeta ? <small>{getMeta(selected)}</small> : null}</span>
        <ChevronDown className="model-picker-chevron" aria-hidden="true" />
      </button>
      {open ? <div className="model-picker-menu" role="listbox" aria-label={ariaLabel}>
        {models.map((model) => <button type="button" role="option" aria-selected={model.id === selected.id} key={model.id} onClick={() => { onChange(model.id); setOpen(false); }}>
          <ModelProviderBadge model={model} />
          <span><strong>{model.name}</strong><small>{getMeta?.(model) || model.modelName || "通用语言模型"}</small></span>
          {model.id === selected.id ? <i aria-hidden="true">✓</i> : null}
        </button>)}
      </div> : null}
    </div>
  );
}
