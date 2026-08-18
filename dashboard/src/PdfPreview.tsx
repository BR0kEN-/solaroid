import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface PdfPreviewProps {
  readonly errorLabel: string;
  readonly loadingLabel: string;
  readonly pageLabel: string;
  readonly url: string;
}

interface PdfPageProps {
  readonly document: PDFDocumentProxy;
  readonly errorLabel: string;
  readonly pageLabel: string;
  readonly pageNumber: number;
}

export function PdfPreview({ errorLabel, loadingLabel, pageLabel, url }: PdfPreviewProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    setDocument(null);
    setError("");

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Document fetch failed with HTTP ${response.status}`);

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
        const loadedDocument = await loadingTask.promise;

        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        setDocument(loadedDocument);
      } catch (cause) {
        if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(errorLabel);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (loadingTask && !loadingTask.destroyed) void loadingTask.destroy();
    };
  }, [errorLabel, url]);

  if (error) return <p className="document-error pdf-preview-status">{error}</p>;
  if (!document) return <p className="pdf-preview-status" role="status">{loadingLabel}</p>;

  return (
    <div className="pdf-preview-pages">
      {Array.from({ length: document.numPages }, (_, index) => (
        <PdfPage
          key={index + 1}
          document={document}
          errorLabel={errorLabel}
          pageLabel={pageLabel}
          pageNumber={index + 1}
        />
      ))}
    </div>
  );
}

function PdfPage({ document, errorLabel, pageLabel, pageNumber }: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.floor(entry.contentRect.width);
      setWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return undefined;

    let cancelled = false;
    let renderTask: RenderTask | undefined;
    setError(false);

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / baseViewport.width });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
          setError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, width]);

  return (
    <div ref={containerRef} className="pdf-preview-page">
      {error ? (
        <p className="document-error pdf-preview-status">{errorLabel}</p>
      ) : (
        <canvas ref={canvasRef} role="img" aria-label={`${pageLabel} ${pageNumber}`} />
      )}
    </div>
  );
}
