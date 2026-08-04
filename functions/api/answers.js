// 匿名作答統計：GET 回全站累計已作答題數；POST 送出一批作答結果，累計每題 attempts/wrong。
import { json } from './_util.js';

async function handleGet(env) {
  const m = await env.DB.prepare("SELECT v FROM meta WHERE k='answered_total'").first();
  return json({ answered: m ? m.v : 0 });
}

async function handlePost(env, request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const items = Array.isArray(body?.items) ? body.items.slice(0, 400) : [];
  if (!items.length) return json({ ok: true, counted: 0 });

  const stmts = [];
  let valid = 0;
  for (const it of items) {
    const qid = String(it.qid || '');
    const prof = String(it.prof || '').slice(0, 20);
    const subject = String(it.subject || '').slice(0, 40);
    if (!qid || qid.length > 80) continue;
    const wrong = it.correct ? 0 : 1;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO qstat(qid,prof,subject,attempts,wrong) VALUES(?,?,?,1,?)
         ON CONFLICT(qid) DO UPDATE SET attempts=attempts+1, wrong=wrong+?`
      ).bind(qid, prof, subject, wrong, wrong)
    );
    valid++;
  }
  if (!valid) return json({ ok: true, counted: 0 });
  stmts.push(
    env.DB.prepare(
      `INSERT INTO meta(k,v) VALUES('answered_total',?) ON CONFLICT(k) DO UPDATE SET v=v+?`
    ).bind(valid, valid)
  );
  await env.DB.batch(stmts);
  return json({ ok: true, counted: valid });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') return handleGet(env);
  if (request.method === 'POST') return handlePost(env, request);
  return new Response('Method Not Allowed', { status: 405 });
}
