import { useEffect, useMemo, useState } from 'react';
import type { IndexData, ExamEntry } from '../lib/types';
import { PROF_SLUG, SLUG_PROF } from '../lib/types';
import { fetchIndex, fetchSubject, shuffle } from '../lib/client';
import Quiz, { type QuizItem } from './Quiz';

type Variant = 'practice' | 'random';
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function toItems(sub: any): QuizItem[] {
  const label = `${sub.profession} ${sub.minguo}年${sub.session} ${sub.subjectShort}`;
  const href = `${base}/${PROF_SLUG[sub.profession]}/${sub.examCode}/${sub.subjectNo}`;
  return sub.questions
    .filter((q: any) => q.mode !== 'scanned' && q.answer)
    .map((q: any) => ({ ...q, prof: sub.profession, file: `${sub.examCode}-${sub.subjectNo}.json`, subjectShort: sub.subjectShort, srcLabel: label, srcHref: href }));
}

export default function QuizApp({ variant }: { variant: Variant }) {
  const [idx, setIdx] = useState<IndexData | null>(null);
  const [prof, setProf] = useState('');
  const [code, setCode] = useState('');
  const [sub, setSub] = useState('');
  const [subShort, setSubShort] = useState('');
  const [yearFrom, setYearFrom] = useState<number>(0);
  const [count, setCount] = useState(30);
  const [items, setItems] = useState<QuizItem[] | null>(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchIndex().then((d) => {
      setIdx(d);
      const p = new URLSearchParams(location.search);
      const ps = p.get('prof'); const pn = ps ? SLUG_PROF[ps] : '';
      if (pn && d.professions[pn]) {
        setProf(pn);
        const c = p.get('code'); const s = p.get('sub');
        if (variant === 'practice' && c && d.professions[pn].exams[c]) {
          if (s) autoRun(d, pn, c, s); else setCode(c);
        }
      }
    }).catch(() => setErr('資料載入失敗'));
  }, []);

  const profs = idx ? Object.keys(idx.professions) : [];
  const exams: [string, ExamEntry][] = useMemo(() =>
    idx && prof ? Object.entries(idx.professions[prof].exams).sort((a, b) => b[0].localeCompare(a[0])) : [], [idx, prof]);
  const subjects = useMemo(() => (code && idx ? idx.professions[prof].exams[code].subjects : []), [idx, prof, code]);
  const subShorts = useMemo(() => {
    if (!idx || !prof) return [] as string[];
    const set = new Set<string>();
    for (const e of Object.values(idx.professions[prof].exams)) for (const s of e.subjects) set.add(s.short);
    return [...set];
  }, [idx, prof]);
  const years = useMemo(() => {
    if (!idx || !prof) return [] as number[];
    return [...new Set(Object.values(idx.professions[prof].exams).map((e) => e.minguo))].sort((a, b) => b - a);
  }, [idx, prof]);

  async function autoRun(d: IndexData, pn: string, c: string, s: string) {
    setLoading(true);
    try {
      const ref = d.professions[pn].exams[c].subjects.find((x) => String(x.no) === String(s));
      if (!ref) throw 0;
      const data = await fetchSubject(pn, ref.file);
      setItems(toItems(data));
      setTitle(`${pn} ${data.minguo}年${data.session}．${data.subjectShort}`);
    } catch { setErr('無法載入此考科'); }
    setLoading(false);
  }
  async function runRandom() {
    if (!idx || !prof || !subShort) return;
    setLoading(true);
    try {
      const refs: { file: string }[] = [];
      for (const e of Object.values(idx.professions[prof].exams)) {
        if (yearFrom && e.minguo < yearFrom) continue;
        for (const s of e.subjects) if (s.short === subShort) refs.push({ file: s.file });
      }
      const subs = await Promise.all(refs.map((r) => fetchSubject(prof, r.file)));
      const pool = subs.flatMap((s) => toItems(s));
      setItems(shuffle(pool).slice(0, count));
      setTitle(`${prof}．${subShort}．隨機 ${Math.min(count, pool.length)} 題`);
    } catch { setErr('組題失敗'); }
    setLoading(false);
  }

  if (items) return <Quiz items={items} title={title} mode={variant} dataBase={base} />;

  const sel = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5';
  const label = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1';

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900 dark:text-white">{variant === 'practice' ? '練習模式' : '隨機出題'}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {variant === 'practice' ? '選擇職類、年度、考科，作答完交卷後核對答案與詳解。' : '選一個考科與年份範圍，隨機抽題快速刷；交卷後看成績。'}
      </p>
      {variant === 'random' && <a href="/mock" className="inline-block mt-2 text-sm text-brand-600 hover:underline">← 回模擬考</a>}
      {err && <div className="mt-4 rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{err}</div>}

      <div className="mt-6 space-y-4">
        <div>
          <label className={label}>職類</label>
          <select className={sel} value={prof} onChange={(e) => { setProf(e.target.value); setCode(''); setSub(''); setSubShort(''); }}>
            <option value="">請選擇…</option>
            {profs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {variant === 'practice' && prof && (
          <div>
            <label className={label}>年度／場次</label>
            <select className={sel} value={code} onChange={(e) => { setCode(e.target.value); setSub(''); }}>
              <option value="">請選擇…</option>
              {exams.map(([c, e]) => <option key={c} value={c}>{e.minguo}年{e.session}</option>)}
            </select>
          </div>
        )}
        {variant === 'practice' && code && (
          <div>
            <label className={label}>考科</label>
            <select className={sel} value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="">請選擇…</option>
              {subjects.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.short}（{s.count}題）</option>)}
            </select>
          </div>
        )}

        {variant === 'random' && prof && (
          <>
            <div>
              <label className={label}>考科</label>
              <select className={sel} value={subShort} onChange={(e) => setSubShort(e.target.value)}>
                <option value="">請選擇…</option>
                {subShorts.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>年份範圍（起）</label>
                <select className={sel} value={yearFrom} onChange={(e) => setYearFrom(+e.target.value)}>
                  <option value={0}>全部年度</option>
                  {years.map((y) => <option key={y} value={y}>{y} 年起</option>)}
                </select>
              </div>
              <div>
                <label className={label}>題數</label>
                <select className={sel} value={count} onChange={(e) => setCount(+e.target.value)}>
                  {[10, 20, 30, 50, 80].map((n) => <option key={n} value={n}>{n} 題</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      <button disabled={loading || (variant === 'random' ? !subShort : !sub)}
        onClick={() => { if (variant === 'random') runRandom(); else autoRun(idx!, prof, code, sub); }}
        className="mt-7 w-full rounded-xl bg-brand-600 text-white font-semibold py-3 hover:bg-brand-700 disabled:opacity-40 transition">
        {loading ? '載入中…' : '開始'}
      </button>
    </div>
  );
}
