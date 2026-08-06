import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, Cloud, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Brand } from "./Brand";

export function useDelayedPending(pending: boolean, delay = 200) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay, pending]);
  return visible;
}

export function BrandLoader({ label, detail, timeout = 12_000, onRetry }: {
  label: string;
  detail?: string;
  timeout?: number;
  onRetry?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), timeout);
    return () => window.clearTimeout(timer);
  }, [label, timeout]);
  return (
    <div className="brand-loader" role="status" aria-live="polite">
      <div className="brand-loader-orbit">
        <Brand compact />
        {!reduceMotion ? <motion.i animate={{ rotate: 360 }} transition={{ duration: 2.8, ease: "linear", repeat: Infinity }} /> : <i />}
        {!reduceMotion ? <motion.b animate={{ scale: [0.82, 1, 0.82], opacity: [.45, 1, .45] }} transition={{ duration: 1.6, repeat: Infinity }} /> : <b />}
      </div>
      <strong>{timedOut ? "连接时间较长" : label}</strong>
      <span>{timedOut ? "请检查服务状态后重试，当前页面不会无限等待。" : detail}</span>
      {timedOut && onRetry ? <button className="button secondary compact" onClick={onRetry}><RotateCcw size={14} />重新尝试</button> : null}
    </div>
  );
}

export function LoadingBlock({ pending, label, children, className = "" }: {
  pending: boolean;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const visible = useDelayedPending(pending);
  return (
    <AnimatePresence mode="wait">
      {visible ? (
        <motion.div className={`loading-block ${className}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="status">
          <LoadingDots />
          <span>{label}</span>
        </motion.div>
      ) : children ? <>{children}</> : null}
    </AnimatePresence>
  );
}

export function LoadingDots({ compact = false }: { compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  return <span className={`loading-dots ${compact ? "compact" : ""}`} aria-hidden="true">{[0, 1, 2].map((index) => <motion.i key={index} animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [.42, 1, .42] }} transition={{ duration: .9, delay: index * .12, repeat: Infinity }} />)}</span>;
}

export function StageProgress({ progress, stages }: { progress: number; stages: string[] }) {
  const current = Math.min(stages.length - 1, Math.floor((Math.max(0, Math.min(progress, 99)) / 100) * stages.length));
  return (
    <div className="stage-progress" aria-label={`${stages[current]} ${progress}%`}>
      <div><motion.i animate={{ width: `${Math.max(4, progress)}%` }} transition={{ type: "spring", stiffness: 180, damping: 24 }} /></div>
      <span>{stages[current]}</span><strong>{progress}%</strong>
    </div>
  );
}

export function SaveIndicator({ state, published, error }: {
  state: "idle" | "dirty" | "saving" | "saved" | "publishing";
  published: boolean;
  error?: string;
}) {
  if (error) return <span className="save-indicator error"><AlertCircle size={13} />{error}</span>;
  if (state === "saving") return <span className="save-indicator"><LoadingDots compact />正在保存草稿</span>;
  if (state === "publishing") return <span className="save-indicator publishing"><LoadingDots compact />正在发布与索引</span>;
  if (state === "dirty") return <span className="save-indicator"><Cloud size={13} />等待自动保存</span>;
  return <span className={`save-indicator ${published ? "published" : ""}`}><Check size={13} />{published ? "已发布 · 草稿已保存" : "草稿已保存 · 待发布"}</span>;
}
