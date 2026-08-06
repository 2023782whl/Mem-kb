import type { Asset } from "../../types/domain";

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function AssetStatus({ status }: { status: Asset["status"] }) {
  const text = { queued: "排队中", indexing: "解析中", ready: "已入库", failed: "失败", deleted: "已删除" }[status];
  return <span className={`asset-status ${status}`}>{text}</span>;
}
