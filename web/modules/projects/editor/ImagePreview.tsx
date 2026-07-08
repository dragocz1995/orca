'use client';
import { useEffect, useState } from 'react';
import { elowenClient } from '../../../lib/elowenClient';

/** Image preview — fetches the raw bytes with the bearer token in an Authorization header (not the
 *  URL query string, which would leak the token into proxy/referrer/history logs — finding W4) and
 *  renders them via a short-lived object URL, revoked on unmount / path change. */
export function ImagePreview({ projectId, path }: { projectId: number; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    elowenClient.projectRawBlob(projectId, path)
      .then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, path]);

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-bg p-6">
      {failed ? <p className="text-sm text-text-muted">{path}</p>
        : url ? (
          // eslint-disable-next-line @next/next/no-img-element -- daemon-served bytes via object URL, not a Next asset
          <img src={url} alt={path} className="max-h-full max-w-full object-contain" />
        ) : null}
    </div>
  );
}
