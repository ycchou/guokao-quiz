// 匿名訪客計數：GET 讀取 {today,total}；POST 計數 +1（伺服器端雜湊 IP 去重）。
import { taipeiDay, sha256Hex, uaBucket, json } from './_util.js';

const CAP_PER_IP_PER_DAY = 50;

async function readStats(DB) {
  const today = taipeiDay();
  const t = await DB.prepare('SELECT count FROM daily WHERE day = ?').bind(today).first();
  const tot = await DB.prepare('SELECT COALESCE(SUM(count),0) AS total FROM daily').first();
  return { today: t ? t.count : 0, total: tot ? tot.total : 0 };
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const stats = await readStats(env.DB);
  const h = url.searchParams.get('history');
  if (h) {
    const n = Math.min(parseInt(h, 10) || 30, 365);
    const rows = await env.DB.prepare('SELECT day, count FROM daily ORDER BY day DESC LIMIT ?').bind(n).all();
    stats.history = (rows.results || []).reverse();
  }
  return json(stats);
}

export async function onRequestPost({ env, request }) {
  const day = taipeiDay();
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const salt = env.SALT || 'gq-visits-fallback-salt';
  const ipday = await sha256Hex(salt + '|' + ip + '|' + day);
  const h = await sha256Hex(salt + '|' + ip + '|' + uaBucket(request.headers.get('User-Agent')) + '|' + day);

  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM seen WHERE ipday = ?').bind(ipday).first();
  if (cnt && cnt.n >= CAP_PER_IP_PER_DAY) return json(await readStats(env.DB));

  const claim = await env.DB.prepare('INSERT OR IGNORE INTO seen(h,ipday,day) VALUES(?,?,?)').bind(h, ipday, day).run();
  const isNew = claim.meta && claim.meta.changes > 0;
  if (!isNew) return json(await readStats(env.DB));

  const res = await env.DB.batch([
    env.DB.prepare('INSERT INTO daily(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').bind(day),
    env.DB.prepare('SELECT count FROM daily WHERE day = ?').bind(day),
    env.DB.prepare('SELECT COALESCE(SUM(count),0) AS total FROM daily'),
  ]);
  const t = res[1].results && res[1].results[0];
  const tot = res[2].results && res[2].results[0];
  return json({ today: t ? t.count : 0, total: tot ? tot.total : 0 });
}
