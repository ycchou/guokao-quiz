import { useEffect, useMemo, useState } from 'react';
import type { IndexData, ExamEntry } from '../lib/types';
import { SLUG_PROF, PROF_SLUG } from '../lib/types';
import { fetchIndex, fetchSubject } from '../lib/client';
import MockRunner, { type MockSession } from './MockRunner';
import type { QuizItem } from './Quiz';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function MockApp() {
  const [idx, setIdx] = useState<IndexData | null>(null);
  const [prof, setProf] = useState('');
  const [code, setCode] = useState('');
  const [sub, setSub] = useState('all');
  const [scoring, setScoring] = useState<'each' | 'end'>('end');
  const [sessions, setSessions] = useState<MockSession[] | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchIndex().then((d) => {
      setIdx(d);
      const p = new URLSearchParams(location.search);
      const ps = p.get('prof'); const pn = ps ? SLUG_PROF[ps] : '';
      if (pn && d.professions[pn]) { setProf(pn); const c = p.get('code'); if (c && d.professions[pn].exams[c]) setCode(c); }
    }).catch(() => setErr('資料載入失敗'));
  }, []);

  const profs = idx ? Object.keys(idx.professions) : [];
  const exams: [string, ExamEntry][] = useMemo(() =>
    idx && prof ? Object.entries(idx.professions[prof].exams).sort((a, b) => b[0].localeCompare(a[0])) : [], [idx, prof]);
  const subjects = useMemo(() => (idx && code ? idx.professions[prof].exams[code].subjects : []), [idx, prof, code]);

  async function start() {
    if (!idx || !prof || !code) return;
    setLoading(true); setErr('');
    try {
      const e = idx.professions[prof].exams[code];
      const refs = sub === 'all' ? e.subjects : e.subjects.filter((s) => String(s.no) === sub);
      const built: MockSession[] = [];
      for (const ref of refs.sort((a, b) => a.no - b.no)) {
        const data = await fetchSubject(prof, ref.file);
        const href = `${base}/${PROF_SLUG[prof]}/${data.examCode}/${data.subjectNo}`;
        const lab = `${prof} ${data.minguo}年${data.session} ${data.subjectShort}`;
        const items: QuizItem[] = data.questions
          .filter((q) => q.mode !== 'scanned' && q.answer)
          .map((q) => ({ ...q, prof, file: ref.file, srcLabel: lab, srcHref: href }));
        if (items.length) built.push({ label: data.subjectShort, fullLabel: lab, items, timeLimitSec: (data.timeLimitMin ?? 60) * 60 });
      }
      if (!built.length) throw 0;
      setSessions(built);
      setTitle(`${prof} ${e.minguo}年${e.session}`);
    } catch { setErr('無法載入此考試'); }
    setLoading(false);
  }

  if (sessions) return <MockRunner title={title} sessions={sessions} scoring={scoring} dataBase={base} />;

  const sel = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5';
  const label = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1';

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900 dark:text-white">模擬考試</h1>
      <p className="mt-1 text-sm text-slate-500">比照實際考試，每一科獨立限時（60 分鐘），交卷後才能考下一科。</p>
      <a href="/random" className="inline-block mt-2 text-sm text-brand-600 hover:underline">想快速刷題？改用「隨機出題」 →</a>
      {err && <div className="mt-4 rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{err}</div>}

      <div className="mt-6 space-y-4">
        <div>
          <label className={label}>職類</label>
          <select className={sel} value={prof} onChange={(e) => { setProf(e.target.value); setCode(''); setSub('all'); }}>
            <option value="">請選擇…</option>
            {profs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {prof && (
          <div>
            <label className={label}>年度／場次</label>
            <select className={sel} value={code} onChange={(e) => { setCode(e.target.value); setSub('all'); }}>
              <option value="">請選擇…</option>
              {exams.map(([c, e]) => <option key={c} value={c}>{e.minguo}年{e.session}</option>)}
            </select>
          </div>
        )}
        {code && (
          <div>
            <label className={label}>考科範圍</label>
            <select className={sel} value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="all">整場（{subjects.length} 科依序考）</option>
              {subjects.map((s) => <option key={s.no} value={s.no}>只考：{s.no}. {s.short}</option>)}
            </select>
          </div>
        )}
        {code && (
          <div>
            <label className={label}>計分方式</label>
            <div className="grid grid-cols-2 gap-2">
              {([['end', '全部考完再算分'], ['each', '每科交卷即算分']] as const).map(([v, t]) => (
                <button key={v} onClick={() => setScoring(v)}
                  className={`rounded-lg border px-3 py-2.5 text-sm ${scoring === v ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/25 font-semibold' : 'border-slate-200 dark:border-slate-700'}`}>{t}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button disabled={loading || !code} onClick={start}
        className="mt-7 w-full rounded-xl bg-brand-600 text-white font-semibold py-3 hover:bg-brand-700 disabled:opacity-40 transition">
        {loading ? '載入中…' : '開始考試'}
      </button>
    </div>
  );
}
