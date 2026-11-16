import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { api } from "../api";

interface AuthImageProps {
  filename: string;
  rev?: number;
  alt: string;
  className?: string;
}

export function AuthImage({ filename, rev = 0, alt, className = "" }: AuthImageProps) {
  const [src, setSrc] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!filename) {
      setSrc("");
      return;
    }
    let active = true;
    let objectUrl = "";
    setFailed(false);

    api
      .fetchImageBlob(filename)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filename, rev]);

  if (!filename || failed || !src) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 text-xs bg-slate-900">
        <ImageIcon className="w-6 h-6" />
        <span>1200 × 630 PNG</span>
      </div>
    );
  }

  return <img src={src} alt={alt} referrerPolicy="no-referrer" className={className} />;
}
