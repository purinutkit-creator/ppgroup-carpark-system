/**
 * LPR images are private (PDPA): the server only returns them to staff with
 * images.view, so they are fetched with the bearer token and shown through an
 * object URL (a plain <img src> cannot send the Authorization header).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { getToken } from '../../lib/api';
import { Modal } from '../ui';

const cache = new Map<string, Promise<string>>();

function fetchImage(path: string): Promise<string> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(`/api/sessions/images?path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } }).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 403 ? 'ไม่มีสิทธิ์ดูภาพ' : 'โหลดภาพไม่สำเร็จ');
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export function useSecureImage(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!path) return;
    let alive = true;
    fetchImage(path).then(
      (u) => alive && setUrl(u),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [path]);
  return { url, error };
}

export function SecureImage({
  path,
  alt = '',
  height = 160,
  width,
  zoom = true,
  caption,
  style,
}: {
  path: string | null | undefined;
  alt?: string;
  height?: number;
  width?: number | string;
  zoom?: boolean;
  caption?: string;
  style?: CSSProperties;
}) {
  const { url, error } = useSecureImage(path);
  const [open, setOpen] = useState(false);
  const box: CSSProperties = {
    height,
    width: width ?? '100%',
    borderRadius: 8,
    background: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    color: '#94a3b8',
    fontSize: 12,
    ...style,
  };
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={box}>
        {!path ? (
          <span>ไม่มีภาพ</span>
        ) : error ? (
          <span>{error}</span>
        ) : !url ? (
          <span>กำลังโหลด…</span>
        ) : (
          <img
            src={url}
            alt={alt}
            onClick={() => zoom && setOpen(true)}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: zoom ? 'zoom-in' : undefined }}
          />
        )}
      </div>
      {caption && <figcaption className="small muted">{caption}</figcaption>}
      {zoom && url && (
        <Modal open={open} onClose={() => setOpen(false)} title={caption ?? alt ?? 'ภาพ'} size="xl">
          <img src={url} alt={alt} style={{ width: '100%', height: 'auto', display: 'block' }} />
        </Modal>
      )}
    </figure>
  );
}
