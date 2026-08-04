// 共用工具（底線開頭不會成為路由）
export function taipeiDay(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function dayMinus(dayStr, n) {
  const d = new Date(dayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function uaBucket(ua) {
  ua = ua || '';
  let os = 'other';
  if (/iPhone|iPad|iPod|iOS/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let br = 'other', ver = '0', m;
  if ((m = ua.match(/Edg\/(\d+)/))) { br = 'Edge'; ver = m[1]; }
  else if ((m = ua.match(/OPR\/(\d+)/))) { br = 'Opera'; ver = m[1]; }
  else if ((m = ua.match(/Firefox\/(\d+)/))) { br = 'Firefox'; ver = m[1]; }
  else if ((m = ua.match(/Chrome\/(\d+)/))) { br = 'Chrome'; ver = m[1]; }
  else if (/Safari/.test(ua) && (m = ua.match(/Version\/(\d+)/))) { br = 'Safari'; ver = m[1]; }
  return os + '|' + br + '|' + ver;
}
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
