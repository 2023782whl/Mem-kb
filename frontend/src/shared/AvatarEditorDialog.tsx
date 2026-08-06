import { Modal } from "antd";
import { ImagePlus, RotateCcw, Sparkles, Type, Upload } from "lucide-react";
import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent
} from "react";
import { api } from "../api/client";
import type { User } from "../types/domain";
import { AVATAR_PRESETS, UserAvatar, type AvatarPreset } from "./UserAvatar";

type AvatarMode = "preset" | "upload" | "initials";
type CropHandle = { toFile: () => Promise<File> };

export function AvatarEditorDialog({ open, user, onClose, onSaved }: { open: boolean; user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const [mode, setMode] = useState<AvatarMode>(user.avatar_type === "preset" ? "preset" : user.avatar_type === "upload" ? "upload" : "initials");
  const [preset, setPreset] = useState<AvatarPreset>((user.avatar_value as AvatarPreset) || "indigo");
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cropRef = useRef<CropHandle>(null);

  useEffect(() => {
    if (!open) return;
    setMode(user.avatar_type === "preset" ? "preset" : user.avatar_type === "upload" ? "upload" : "initials");
    setPreset(AVATAR_PRESETS.includes(user.avatar_value as AvatarPreset) ? user.avatar_value as AvatarPreset : "indigo");
    setSource("");
    setFilename("");
    setError("");
  }, [open, user.avatar_type, user.avatar_value]);

  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);

  function chooseFile(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("头像仅支持 JPG、PNG 或 WebP");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("头像文件不能超过 5MB");
      return;
    }
    if (source) URL.revokeObjectURL(source);
    setSource(URL.createObjectURL(file));
    setFilename(file.name);
    setMode("upload");
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = mode === "upload"
        ? await api.uploadMyAvatar(await cropRef.current!.toFile())
        : await api.setMyAvatar(mode === "preset" ? { type: "preset", value: preset } : { type: "initials" });
      onSaved(result.user);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "头像保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError("");
    try {
      const result = await api.resetMyAvatar();
      onSaved(result.user);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "头像重置失败");
    } finally {
      setBusy(false);
    }
  }

  return <Modal
    open={open}
    width={640}
    title="设置个人头像"
    okText="保存头像"
    cancelText="取消"
    confirmLoading={busy}
    okButtonProps={{ disabled: mode === "upload" && !source }}
    onOk={() => void save()}
    onCancel={onClose}
    footer={(_, { OkBtn, CancelBtn }) => <div className="avatar-modal-footer"><button className="avatar-reset-button" type="button" onClick={() => void reset()} disabled={busy}><RotateCcw size={14} />恢复默认头像</button><span><CancelBtn /><OkBtn /></span></div>}
  >
    <div className="avatar-editor">
      <header className="avatar-editor-current"><UserAvatar user={user} size={64} /><div><strong>{user.name}</strong><span>头像会显示在导航、用户列表和协作区域。</span></div></header>
      <div className="avatar-mode-tabs" role="tablist" aria-label="头像来源">
        <button type="button" className={mode === "preset" ? "active" : ""} onClick={() => setMode("preset")}><Sparkles size={16} />预设头像</button>
        <button type="button" className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}><ImagePlus size={16} />本地上传</button>
        <button type="button" className={mode === "initials" ? "active" : ""} onClick={() => setMode("initials")}><Type size={16} />姓名首字母</button>
      </div>
      {mode === "preset" ? <section className="avatar-preset-section"><p>选择一款统一风格的头像</p><div className="avatar-preset-grid">{AVATAR_PRESETS.map((id) => <button type="button" className={preset === id ? "selected" : ""} key={id} onClick={() => setPreset(id)} aria-label={`选择${id}预设头像`}><UserAvatar user={{ id: user.id, name: user.name, avatar_type: "preset", avatar_value: id }} size={58} /></button>)}</div></section> : null}
      {mode === "upload" ? <section className="avatar-upload-section">
        {source ? <AvatarCropper ref={cropRef} source={source} /> : <label className="avatar-upload-drop"><Upload size={24} /><strong>选择本地图片</strong><span>支持 JPG、PNG、WebP，最大 5MB</span><input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>}
        {source ? <label className="avatar-replace-file"><Upload size={14} />更换图片<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0])} /></label> : null}
        {filename ? <small data-i18n-ignore>{filename}</small> : null}
      </section> : null}
      {mode === "initials" ? <section className="avatar-initials-section"><UserAvatar user={{ ...user, avatar_type: "initials", avatar_value: null }} size={104} /><div><strong>使用姓名首字母</strong><p>当不使用图片时，系统会根据姓名自动生成简洁头像。</p></div></section> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  </Modal>;
}

const AvatarCropper = forwardRef<CropHandle, { source: string }>(function AvatarCropper({ source }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);

  function clampOffset(next: { x: number; y: number }, nextZoom = zoom) {
    const image = imageRef.current;
    if (!image) return next;
    const base = Math.max(512 / image.naturalWidth, 512 / image.naturalHeight) * nextZoom;
    const maxX = Math.max(0, (image.naturalWidth * base - 512) / 2);
    const maxY = Math.max(0, (image.naturalHeight * base - 512) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  }

  useEffect(() => {
    setReady(false);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setReady(true);
    };
    image.src = source;
    return () => { imageRef.current = null; };
  }, [source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, 512, 512);
    const scale = Math.max(512 / image.naturalWidth, 512 / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (512 - width) / 2 + offset.x, (512 - height) / 2 + offset.y, width, height);
  }, [offset, ready, source, zoom]);

  useImperativeHandle(ref, () => ({
    toFile: () => new Promise<File>((resolve, reject) => {
      canvasRef.current?.toBlob((blob) => blob ? resolve(new File([blob], "avatar.webp", { type: "image/webp" })) : reject(new Error("头像裁剪失败")), "image/webp", .9);
    })
  }), []);

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = 512 / rect.width;
    const delta = { x: (event.clientX - dragRef.current.x) * ratio, y: (event.clientY - dragRef.current.y) * ratio };
    dragRef.current = { x: event.clientX, y: event.clientY };
    setOffset((current) => clampOffset({ x: current.x + delta.x, y: current.y + delta.y }));
  }

  return <div className="avatar-cropper">
    <div className="avatar-canvas-frame"><canvas ref={canvasRef} width={512} height={512} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY }; }} onPointerMove={move} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} aria-label="拖动图片调整头像裁剪位置" /></div>
    <label><span>缩放</span><input type="range" min="1" max="2.5" step="0.01" value={zoom} onChange={(event) => { const next = Number(event.target.value); setZoom(next); setOffset((current) => clampOffset(current, next)); }} /></label>
  </div>;
});
