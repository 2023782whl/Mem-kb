import { useEffect, useRef, useState } from "react";
import productLogo from "../assets/icons/product_logo.png";
import productLogoVideo from "../assets/icons/product_logo.mp4";

export function ProductLogoMark({ className = "" }: { className?: string }) {
  const [motionEnabled, setMotionEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionEnabled(!query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!motionEnabled || !video) return;
    const play = video.play();
    if (play) void play.catch(() => undefined);
    return () => video.pause();
  }, [motionEnabled]);

  return (
    <span className={`product-logo-mark ${motionEnabled ? "is-animated" : ""} ${className}`} aria-hidden="true">
      <img className="product-logo" src={productLogo} alt="" />
      {motionEnabled ? (
        <video ref={videoRef} className="product-logo-video" loop muted playsInline preload="metadata" poster={productLogo} tabIndex={-1} disablePictureInPicture>
          <source src={productLogoVideo} type="video/mp4" />
        </video>
      ) : null}
      <i className="product-logo-orbit" />
      <b className="product-logo-pulse" />
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <ProductLogoMark />
      <span>Mem-kb</span>
    </div>
  );
}
