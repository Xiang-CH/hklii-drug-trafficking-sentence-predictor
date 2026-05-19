import { useEffect, useState } from "react";
import { useArtifact } from "@/components/thread/artifact";

type HtmlPreviewProps = {
  title?: string;
  description?: string;
  html: string;
};

export function HtmlPreviewArtifact({
  title = "HTML Preview",
  description = "Generated HTML content",
  html,
}: HtmlPreviewProps) {
  const [Artifact, { open, setOpen }] = useArtifact();

  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      if (iframeUrl) {
        URL.revokeObjectURL(iframeUrl);
      }
      setIframeUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setIframeUrl(null);

    let objectUrl: string;

    const timeout = window.setTimeout(() => {
      const blob = new Blob([html], { type: "text/html" });
      objectUrl = URL.createObjectURL(blob);

      setIframeUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });

      setLoading(false);
    }, 50);

    return () => {
      clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, html]);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="w-full rounded-lg border p-4 text-left hover:bg-gray-50"
      >
        <div className="font-medium">{title}</div>
        <div className="text-sm text-gray-500">{description}</div>
      </button>

      <Artifact title={title}>
        <div className="relative h-full w-full">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-gray-500">
              Rendering preview…
            </div>
          )}

          {iframeUrl && (
            <iframe
              title={title}
              className="h-full w-full border-0"
              sandbox="allow-scripts"
              src={iframeUrl}
              onLoad={() => setLoading(false)}
            />
          )}
        </div>
      </Artifact>
    </>
  );
}