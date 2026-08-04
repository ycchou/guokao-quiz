// 錯誤率排名：GET /api/rankings?prof=&subject=&min=20&limit=50&order=hard|easy
import { json } from './_util.js';

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url);
  const prof = u.searchParams.get('prof') || '';
  const subject = u.searchParams.get('subject') || '';
  const min = Math.max(1, Math.min(parseInt(u.searchParams.get('min') || '20', 10) || 20, 1000));
  const limit = Math.min(parseInt(u.searchParams.get('limit') || '50', 10) || 50, 100);
  const order = u.searchParams.get('order') === 'easy' ? 'ASC' : 'DESC';

  const where = ['attempts >= ?'];
  const binds = [min];
  if (prof) { where.push('prof = ?'); binds.push(prof); }
  if (subject) { where.push('subject = ?'); binds.push(subject); }
  const sql =
    `SELECT qid, prof, subject, attempts, wrong,
            CAST(wrong AS REAL)/attempts AS rate
     FROM qstat WHERE ${where.join(' AND ')}
     ORDER BY rate ${order}, attempts DESC LIMIT ?`;
  binds.push(limit);
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  return json({ rows: rows.results || [] });
}
