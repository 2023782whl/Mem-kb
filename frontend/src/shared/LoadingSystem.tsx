import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, Cloud, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Brand } from "./Brand";

type RouteSkeletonVariant = "qa" | "knowledge" | "notes" | "settings";

const routeSkeletonMeta: Record<RouteSkeletonVariant, { title: string; detail: string; panel: string; rows: number }> = {
  qa: { title: "知识问答", detail: "正在准备会话、模型与知识范围", panel: "会话", rows: 4 },
  knowledge: { title: "知识中心", detail: "正在加载知识资产与预览区", panel: "知识空间", rows: 5 },
  notes: { title: "笔记", detail: "正在加载 Workspace 与笔记内容", panel: "笔记空间", rows: 6 },
  settings: { title: "系统设置", detail: "正在加载账号与系统状态", panel: "企业管理", rows: 7 }
};

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

export function RouteSkeleton({ variant = "qa", title, detail, timeout = 12_000, onRetry }: {
  variant?: RouteSkeletonVariant;
  title?: string;
  detail?: string;
  timeout?: number;
  onRetry?: () => void;
}) {
  const meta = routeSkeletonMeta[variant];
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), timeout);
    return () => window.clearTimeout(timer);
  }, [timeout, title, variant]);

  const resolvedTitle = timedOut ? "连接时间较长" : title || meta.title;
  const resolvedDetail = timedOut ? "请检查服务状态后重试，当前页面不会无限等待。" : detail || meta.detail;

  return (
    <div className={`route-skeleton app-shell route-skeleton-${variant}`} role="status" aria-live="polite" aria-busy="true">
      <aside className="route-skeleton-rail">
        <Brand compact />
        <div className="route-skeleton-nav">
          {[0, 1, 2].map((item) => <span key={item}><i className="skeleton-shape" /><b className="skeleton-line short" /></span>)}
        </div>
        <div className="route-skeleton-bottom">
          <i className="skeleton-shape" />
          <i className="skeleton-shape" />
        </div>
      </aside>
      <section className="route-skeleton-stage">
        <header className="route-skeleton-topbar">
          <div>
            <strong>{resolvedTitle}</strong>
            <span>{resolvedDetail}</span>
          </div>
          <div>
            <i className="skeleton-pill wide" />
            <i className="skeleton-pill" />
            <i className="skeleton-avatar" />
          </div>
        </header>
        <main className="route-skeleton-main">
          <section className="route-skeleton-panel">
            <span>{meta.panel}</span>
            <b className="skeleton-line title" />
            <i className="skeleton-pill full" />
            {Array.from({ length: meta.rows }, (_, index) => <b key={index} className={`skeleton-line ${index % 3 === 1 ? "medium" : ""}`} />)}
          </section>
          <section className="route-skeleton-content">
            <i className="skeleton-logo" />
            <b className="skeleton-line hero" />
            <b className="skeleton-line medium" />
            <div className="route-skeleton-card">
              <b className="skeleton-line full" />
              <b className="skeleton-line full" />
              <b className="skeleton-line medium" />
              <div>
                <i className="skeleton-pill" />
                <i className="skeleton-pill" />
                <i className="skeleton-pill" />
              </div>
              {timedOut && onRetry ? (
                <button className="button secondary compact route-skeleton-retry" onClick={onRetry}>
                  <RotateCcw size={14} />重新尝试
                </button>
              ) : null}
            </div>
          </section>
        </main>
      </section>
    </div>
  );
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
