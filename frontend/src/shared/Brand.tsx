import productLogo from "../assets/icons/product_logo.png";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <img className="product-logo" src={productLogo} alt="" aria-hidden="true" />
      <span>Mem-kb</span>
    </div>
  );
}
