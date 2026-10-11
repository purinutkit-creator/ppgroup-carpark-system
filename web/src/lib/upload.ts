import { api } from './api';

/** Upload a file to /api/media (public uploads). Returns its URL. */
export async function uploadMedia(file: File, folder = 'media'): Promise<string> {
  const fd = new FormData();
  fd.append('folder', folder);
  fd.append('file', file);
  const r = await api<{ url: string }>('/api/media', { method: 'POST', body: fd });
  return r.url;
}
