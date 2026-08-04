import { useEffect, useMemo, useState } from 'react';
import type { IndexData } from '../lib/types';
import { PROF_SLUG } from '../lib/types';
import { fetchIndex, fetchSubject, fetchRankings } from '../lib/client';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

interface Row { qid: string; prof: string; subject: string; attempts: number; wrong: number; rate: number; stem?: string; href?: string; }

export default function RankingsApp() {
  const [idx, setIdx] = useState<IndexData | null>(null);
  const [prof, setProf] = useState('');
  const [subject, setSubject] = useState('');
  const [order, setOrder] = useState<'hard' | 'easy'>('hard');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchIndex().then(setIdx).catch(() => {}); }, []);
  useEffect(() => { load(); }, [prof, subject, order]);

  const profs = idx ? Object.keys(idx.professions) : [];
  const subShorts = useMemo(() => {
    if (!idx || !prof) return [] as string[];
    const s = new Set<string>();
    for (const e of Object.values(idx.professions[prof].exams)) for (const x of e.subjects) s.add(x.short);
    return [...s];
  }, [idx, prof]);

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, string> = { min: '10', limit: '50', order };
      if (prof) params.prof = prof;
      if (subject) params.subject = subject;
      const { rows } = await fetchRankings(params);
      // 解析題幹
      const enriched: Row[] = await Promise.all((rows as Row[]).map(async (r) => {
        const [p, file, noStr] = r.qid.split('|');
        const no = parseInt(noStr, 10);
        const m = file.match(/^(\d+)-(\d+)\.json$/);
        let stem = '', href = '';
        if (m) {
          href = `${base}/${PROF_SLUG[p] || p}/${m[1]}/${m[2]}#q${no}`;
          try {
            const sub = await fetchSubject(p, file);
            const q = sub.questions.find((x) => x.no === no);
            stem = q?.stem || (q?.mode === 'image' ? '（圖片題）' : '');
          } catch { /* ignore */ }
        }
        return { ...r, stem, href };
      }));
      setRows(enriched);
    } catch { setRows([]); }
    setLoading(false);
  }

  const sel = 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm';

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900 dark:text-white">錯誤率排行榜</h1>
      <p className="mt-1 text-sm text-slate-500">依全站考生的實際作答統計，找出最容易答錯（或最好拿分）的題目。至少 10 次作答才列入。</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <select className={sel} value={prof} onChange={(e) => { setProf(e.target.value); setSubject(''); }}>
          <option value="">全部職類</option>
          {profs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {prof && (
          <select className={sel} value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">全部考科</option>
            {subShorts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select className={sel} value={order} onChange={(e) => setOrder(e.target.value as any)}>
          <option value="hard">最容易答錯</option>
          <option value="easy">最好拿分</option>
        </select>
      </div>

      {loading && <p className="mt-6 text-slate-500">載入中…</p>}
      {!loading && rows && rows.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-400">
          目前還沒有足夠的作答資料。多做幾題、或邀請大家一起來練習，排行榜就會出現囉！
        </div>
      )}

      <ol className="mt-5 space-y-2">
        {rows?.map((r, i) => (
          <li key={r.qid} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex items-start gap-3">
            <span className="w-7 h-7 shrink-0 grid place-items-center rounded-lg bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-sm font-bold">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <a href={r.href} className="text-slate-900 dark:text-white hover:text-brand-600 line-clamp-2 text-[15px]">{r.stem || r.qid}</a>
              <div className="mt-1 text-xs text-slate-400">{r.prof}．{r.subject}．作答 {r.attempts} 次</div>
            </div>
            <div className="text-right shrink-0">
              <div className={`font-bold ${r.rate >= 0.5 ? 'text-rose-600' : 'text-emerald-600'}`}>{Math.round(r.rate * 100)}%</div>
              <div className="text-xs text-slate-400">錯誤率</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
