import { Boxes, CheckCircle2, MoreHorizontal, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ModelConfig, ModelConfigInput, ModelInfo } from "../../types/domain";
import { ConfirmActionDialog } from "../../shared/EntityDialogs";
import { ModelEditorDialog } from "./ModelEditorDialog";

function protocolName(value?: string) {
  if (value === "anthropic_messages") return "Anthropic";
  if (value === "gemini_generate_content") return "Gemini";
  return "OpenAI";
}

function status(model: ModelInfo) {
  if (model.source === "static") return model.configured ? "环境可用" : "缺少密钥";
  if (model.verificationStatus === "failed") return "验证失败";
  if (model.verificationStatus !== "verified") return "待验证";
  return model.enabled ? "可用" : "已停用";
}

export function ModelSettings({ initialModels, canManage }: { initialModels: ModelInfo[]; canManage: boolean }) {
  const [models, setModels] = useState(initialModels);
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [editor, setEditor] = useState<ModelConfig | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModelConfig | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const visibleModels = models.filter((model) => model.kind === "LLM" || model.kind === "IMAGE");

  const reload = async () => {
    const [catalog, configured] = await Promise.all([api.models(), canManage ? api.modelConfigs() : Promise.resolve({ configs: [] })]);
    setModels(catalog.models);
    setConfigs(configured.configs);
  };
  useEffect(() => { setModels(initialModels); }, [initialModels]);
  useEffect(() => { if (canManage) void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "模型加载失败")); }, [canManage]);

  const save = async (input: ModelConfigInput) => {
    const updateInput = { ...input };
    if (!updateInput.apiKey?.trim()) delete updateInput.apiKey;
    const saved = editor && editor !== "new"
      ? await api.updateModelConfig(editor.id, updateInput)
      : await api.createModelConfig(input as ModelConfigInput & { apiKey: string });
    const tested = await api.testModelConfig(saved.config.id);
    await api.enableModelConfig(saved.config.id, true);
    return tested.checks;
  };

  const operate = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError("");
    try { await action(); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "模型操作失败"); }
    finally { setBusyId(""); }
  };

  return <div className="settings-content">
    <header className="settings-section-head with-actions"><div><h1>模型配置</h1><p>后端运行时模型与能力，浏览器不保存密钥。</p></div>{canManage ? <button className="settings-primary-action" onClick={() => setEditor("new")}><Plus size={15} />增加模型</button> : null}</header>
    {error ? <div className="inline-notice">{error}</div> : null}
    <div className="enterprise-table model-table model-config-table">
      <div className="enterprise-table-head"><span>模型</span><span>类型 / 协议</span><span>视觉</span><span>状态</span><span>操作</span></div>
      {visibleModels.map((model) => {
        const config = configs.find((item) => item.id === model.id);
        const busy = busyId === model.id;
        return <div key={`${model.source || "static"}:${model.id}`}>
          <span className="model-identity"><span className="model-provider-icon"><Boxes size={17} /></span><span><strong>{model.name}{model.isDefault ? <em className="model-default-badge">默认</em> : null}</strong><em>{model.modelName}</em></span></span>
          <span className="model-protocol-cell"><strong>{model.kind}</strong><em>{protocolName(model.apiProtocol)}</em></span><span>{model.supportsVision ? "支持" : "-"}</span>
          <span className={`model-runtime-status ${model.configured ? "ok" : model.verificationStatus === "failed" ? "failed" : ""}`}><i />{status(model)}</span>
          <span className="model-row-actions">{config ? <>
            <button title="编辑" disabled={busy} onClick={() => setEditor(config)}><Pencil size={14} /></button>
            {model.verificationStatus !== "verified" ? <button title="重新验证" disabled={busy} onClick={() => void operate(model.id, async () => { await api.testModelConfig(model.id); await api.enableModelConfig(model.id, true); })}><RefreshCw size={14} /></button> : null}
            {!model.isDefault && model.enabled ? <button title="设为默认" disabled={busy} onClick={() => void operate(model.id, () => api.defaultModelConfig(model.id))}><Star size={14} /></button> : null}
            <button title={model.enabled ? "停用" : "启用"} disabled={busy || model.verificationStatus !== "verified"} onClick={() => void operate(model.id, () => api.enableModelConfig(model.id, !model.enabled))}>{model.enabled ? <CheckCircle2 size={14} /> : <MoreHorizontal size={14} />}</button>
            <button className="danger" title="删除" disabled={busy || model.isDefault} onClick={() => setDeleting(config)}><Trash2 size={14} /></button>
          </> : <span className="model-static-label">配置文件</span>}</span>
        </div>;
      })}
    </div>
    {!visibleModels.length ? <div className="settings-empty"><Boxes size={30} /><strong>暂无模型</strong><span>管理员可以增加第一个运行时模型。</span></div> : null}
    <ModelEditorDialog open={Boolean(editor)} config={editor === "new" ? null : editor} onCancel={() => setEditor(null)} onSave={save} onComplete={() => { setEditor(null); void reload(); }} />
    <ConfirmActionDialog open={Boolean(deleting)} title="删除模型配置" description="密钥与配置将软删除，历史问答记录仍会保留。" subject={deleting?.name} danger confirmText="删除" busy={busyId === deleting?.id} onCancel={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; await operate(deleting.id, () => api.deleteModelConfig(deleting.id)); setDeleting(null); }} />
  </div>;
}
