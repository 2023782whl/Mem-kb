import { Check, Circle, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelConfig, ModelConfigInput, ModelProtocol } from "../../types/domain";
import { EntityModal } from "../../shared/EntityDialogs";

const protocols: Array<{ value: ModelProtocol; label: string }> = [
  { value: "openai_chat_completions", label: "OpenAI Compatible" },
  { value: "anthropic_messages", label: "Anthropic Messages" },
  { value: "gemini_generate_content", label: "Gemini GenerateContent" }
];

const emptyForm: ModelConfigInput = {
  name: "",
  kind: "LLM",
  apiProtocol: "openai_chat_completions",
  baseUrl: "https://api.openai.com/v1",
  modelName: "",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 8192,
  supportsVision: false,
  capabilities: ["analysis"],
  extraBody: {}
};

function initialForm(config: ModelConfig | null): ModelConfigInput {
  if (!config) return emptyForm;
  return {
    name: config.name,
    kind: config.kind,
    apiProtocol: config.api_protocol,
    baseUrl: config.base_url,
    modelName: config.model_name,
    apiKey: "",
    temperature: config.temperature,
    maxTokens: config.max_tokens,
    supportsVision: config.supports_vision,
    capabilities: config.capabilities,
    extraBody: config.extra_body
  };
}

export function ModelEditorDialog({ open, config, onCancel, onSave, onComplete }: {
  open: boolean;
  config: ModelConfig | null;
  onCancel: () => void;
  onSave: (input: ModelConfigInput) => Promise<{ text: boolean; stream: boolean; json: boolean }>;
  onComplete: () => void;
}) {
  const [form, setForm] = useState<ModelConfigInput>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "running" | "passed" | "failed">("idle");
  const [checks, setChecks] = useState({ text: false, stream: false, json: false });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(config));
    setStage("idle");
    setChecks({ text: false, stream: false, json: false });
    setError("");
  }, [open, config]);

  const update = <K extends keyof ModelConfigInput>(key: K, value: ModelConfigInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.name.trim() && form.baseUrl.trim() && form.modelName.trim() && (config || form.apiKey?.trim());

  const submit = async () => {
    setBusy(true);
    setStage("running");
    setError("");
    try {
      const result = await onSave({ ...form, capabilities: [...new Set(form.capabilities.map((item) => item.trim()).filter(Boolean))] });
      setChecks(result);
      setStage("passed");
      window.setTimeout(onComplete, 550);
    } catch (reason) {
      setStage("failed");
      setError(reason instanceof Error ? reason.message : "模型连接验证失败");
    } finally {
      setBusy(false);
    }
  };

  return <EntityModal
    open={open}
    width={780}
    title={config ? "编辑模型" : "增加模型"}
    description="密钥仅发送到服务端加密保存；文本、流式与 JSON 三项验证通过后才会启用。"
    busy={busy}
    confirmText={stage === "passed" ? "验证通过" : "保存并验证"}
    confirmDisabled={!valid || stage === "passed"}
    onCancel={onCancel}
    onConfirm={submit}
  >
    <div className="model-editor-layout">
      <div className="model-editor-form">
        <label className="entity-field"><span>显示名称</span><input autoFocus value={form.name} placeholder="例如：企业问答模型" onChange={(event) => update("name", event.target.value)} /></label>
        <div className="model-editor-grid">
          <label className="entity-field"><span>模型类型</span><select value={form.kind} onChange={(event) => update("kind", event.target.value as ModelConfigInput["kind"])}><option value="LLM">LLM</option><option value="IMAGE">视觉模型</option></select></label>
          <label className="entity-field"><span>协议</span><select value={form.apiProtocol} onChange={(event) => update("apiProtocol", event.target.value as ModelProtocol)}>{protocols.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        <label className="entity-field"><span>API Base URL</span><input value={form.baseUrl} placeholder="https://gateway.example.com/v1" onChange={(event) => update("baseUrl", event.target.value)} /></label>
        <label className="entity-field"><span>模型标识</span><input value={form.modelName} placeholder="gpt-5.5" onChange={(event) => update("modelName", event.target.value)} /></label>
        <label className="entity-field"><span>API Key {config ? <em>留空则保持原密钥</em> : null}</span><input type="password" autoComplete="new-password" value={form.apiKey || ""} placeholder={config ? "••••••••" : "输入服务端模型密钥"} onChange={(event) => update("apiKey", event.target.value)} /></label>
        <div className="model-editor-grid">
          <label className="entity-field"><span>温度</span><input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => update("temperature", Number(event.target.value))} /></label>
          <label className="entity-field"><span>最大输出 Token</span><input type="number" min="128" max="200000" value={form.maxTokens} onChange={(event) => update("maxTokens", Number(event.target.value))} /></label>
        </div>
        <label className="model-vision-toggle"><input type="checkbox" checked={form.supportsVision} onChange={(event) => update("supportsVision", event.target.checked)} /><span><strong>支持视觉输入</strong><em>允许图片分析与多模态问答</em></span></label>
      </div>
      <aside className={`model-verification-rail ${stage}`}>
        <header><span><ShieldCheck size={18} /></span><div><strong>连接验证</strong><em>运行时能力检查</em></div></header>
        <VerificationStep label="文本响应" active={stage === "running"} passed={checks.text} failed={stage === "failed"} />
        <VerificationStep label="流式输出" active={stage === "running"} passed={checks.stream} failed={stage === "failed"} />
        <VerificationStep label="JSON 结构" active={stage === "running"} passed={checks.json} failed={stage === "failed"} />
        <p>{stage === "idle" ? "保存后将自动执行三项真实请求。" : stage === "running" ? "正在验证模型网关，请稍候…" : stage === "passed" ? "配置已验证并启用。" : error}</p>
      </aside>
    </div>
  </EntityModal>;
}

function VerificationStep({ label, active, passed, failed }: { label: string; active: boolean; passed: boolean; failed: boolean }) {
  return <div className={passed ? "passed" : failed ? "failed" : active ? "active" : ""}>
    <span>{passed ? <Check size={13} /> : failed ? <XCircle size={13} /> : active ? <LoaderCircle size={13} /> : <Circle size={12} />}</span><strong>{label}</strong>
  </div>;
}
