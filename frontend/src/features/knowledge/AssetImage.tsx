import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { api } from "../../api/client";
import { motion } from "motion/react";

export function AssetImage({ assetId, alt, original = false }: { assetId: string; alt: string; original?: boolean }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let active = true;
    const controller = new AbortController();
    setUrl("");
    setFailed(false);
    api.assetBlob(assetId, original ? "original" : "thumbnail", controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, original]);

  if (failed) return <span className="asset-image-fallback"><ImageOff size={20} /></span>;
  return url ? <motion.img src={url} alt={alt} initial={{ opacity: 0, filter: "blur(8px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} /> : <span className="asset-image-skeleton"><i /></span>;
}
