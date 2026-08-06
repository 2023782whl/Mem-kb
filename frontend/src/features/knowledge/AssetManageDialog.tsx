import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { EntityModal } from "../../shared/EntityDialogs";
import type { Asset, Category, Product, Workspace } from "../../types/domain";

export function AssetManageDialog({ asset, workspaces, onClose, onChanged }: {
  asset: Asset;
  workspaces: Workspace[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState(asset.title);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [workspaceId, setWorkspaceId] = useState(asset.workspace_id);
  const [categoryId, setCategoryId] = useState(asset.category_id || "");
  const [productId, setProductId] = useState(asset.product_id || "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (asset.type !== "image") return;
    Promise.all([api.categories(workspaceId), api.products(workspaceId)])
      .then(([categoryResult, productResult]) => {
        setCategories(categoryResult.categories);
        setProducts(productResult.products);
        if (!categoryResult.categories.some((item) => item.id === categoryId)) { setCategoryId(""); setProductId(""); }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "类目加载失败"));
  }, [workspaceId]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.updateAsset(asset.id, {
        title: title.trim(),
        workspaceId,
        ...(asset.type === "image" ? { categoryId, productId } : {}),
        tags: tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
      });
      await onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资产更新失败");
    } finally {
      setBusy(false);
    }
  }

  const targetKind = asset.type === "image" ? "image" : "document";
  const targetWorkspaces = workspaces.filter((item) => item.kind === "mixed" || item.kind === targetKind);
  const leafCategories = categories.filter((item) => item.level === 3);
  const productOptions = products.filter((item) => item.category_id === categoryId);
  return <EntityModal open width={560} title="管理资产" description="重命名、添加标签，或移动到其他 Workspace。" busy={busy} confirmText="保存更改" confirmDisabled={!title.trim() || (asset.type === "image" && (!categoryId || !productId))} onCancel={onClose} onConfirm={save}>
    <label className="entity-field"><span>名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="entity-field"><span>目标 Workspace</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{targetWorkspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {asset.type === "image" ? <><label className="entity-field"><span>三级类目</span><select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setProductId(""); }}><option value="">请选择</option>{leafCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="entity-field"><span>商品</span><select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">请选择</option>{productOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></> : null}
    <label className="entity-field"><span>标签（逗号分隔）</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="活动, 防晒衣, 主图" /></label>
    {error ? <p className="form-error">{error}</p> : null}
  </EntityModal>;
}
