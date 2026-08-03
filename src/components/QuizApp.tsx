import { useEffect, useMemo, useState } from 'react';
import type { IndexData, Subject, ExamEntry } from '../lib/types';
import { PROF_SLUG, SLUG_PROF } from '../lib/types';
import { fetchIndex, fetchSubject, shuffle } from '../lib/client';
import Quiz, { type QuizItem } from './Quiz';

type Variant = 'practice' | 'mock' | 'random';
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function toItems(sub: Subject, forQuiz = true): QuizItem[] {
  const label = `${sub.profession} ${sub.minguo}年${sub.session} ${sub.subjectShort}`;
  const href = `${base}/${PROF_SLUG[sub.profession]}/${sub.examCode}/${sub.subjectNo}`;
  return sub.questions
    .filter((q) => (forQuiz ? q.mode !== 'scanned' && q.answer : true))
    .map((q) => ({ ...q, prof: sub.profession, file: `${sub.examCode}-${sub.subjectNo}.json`, srcLabel: label, srcHref: href }));
}

export default function QuizApp({ variant }: { variant: Variant }) {
  const [idx, setIdx] = useState<IndexData | null>(null);
  const [prof, setProf] = useState('');
  const [code, setCode] = useState('');
  const [sub, setSub] = useState('');
  const [subShort, setSubShort] = useState(''); // random: by subject short-name
  const [yearFrom, setYearFrom] = useState<number>(0);
  const [count, setCount] = useState(30);
  const [items, setItems] = useState<QuizItem[] | null>(null);
  const [title, setTitle] = useState('');
  const [timeLimit, setTimeLimit] = useState<number | undefined>();
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
        if (variant !== 'random' && c && d.professions[pn].exams[c]) {
          if (s) autoRun(d, pn, c, s);
          else if (variant === 'mock') autoRunExam(d, pn, c);
          else { setCode(c); }
        }
      }
    }).catch(() => setErr('資料載入失敗'));
  }, []);

  const profs = idx ? Object.keys(idx.professions) : [];
  const exams: [string, ExamEntry][] = useMemo(() => {
    if (!idx || !prof) return [];
    return Object.entries(idx.professions[prof].exams).sort((a, b) => b[0].localeCompare(a[0]));
  }, [idx, prof]);
  const subjects = useMemo(() => (code && idx ? idx.professions[prof].exams[code].subjects : []), [idx, prof, code]);
  // random: distinct subject short-names for the profession
  const subShorts = useMemo(() => {
    if (!idx || !prof) return [] as string[];
    const set = new Set<string>();
    for (const e of Object.values(idx.professions[prof].exams))
      for (const s of e.subjects) set.add(s.short);
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
      const its = toItems(data);
      setItems(its);
      setTitle(`${pn} ${data.minguo}年${data.session}．${data.subjectShort}`);
      setTimeLimit(variant === 'mock' ? (data.timeLimitMin ?? 60) * 60 : undefined);
    } catch { setErr('無法載入此考科'); }
    setLoading(false);
  }
  async function autoRunExam(d: IndexData, pn: string, c: string) {
    setLoading(true);
    try {
      const e = d.professions[pn].exams[c];
      const subs = await Promise.all(e.subjects.map((r) => fetchSubject(pn, r.file)));
      const its = subs.flatMap((s) => toItems(s));
      setItems(its);
      setTitle(`${pn} ${e.minguo}年${e.session} 整場模擬`);
      setTimeLimit(subs.reduce((a, s) => a + (s.timeLimitMin ?? 60), 0) * 60);
    } catch { setErr('無法載入此考試'); }
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
      setTimeLimit(undefined);
    } catch { setErr('組題失敗'); }
    setLoading(false);
  }

  if (items) return <Quiz items={items} title={title} mode={variant} timeLimitSec={timeLimit} dataBase={base} />;

  const sel = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5';
  const label = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1';

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
        {variant === 'practice' ? '練習模式' : variant === 'mock' ? '模擬考試' : '隨機出題'}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {variant === 'practice' ? '選擇職類、年度、考科，作答後立即核對答案。'
          : variant === 'mock' ? '比照實際考試限時作答，結束後看成績與詳解。'
            : '選一個考科與年份範圍，隨機抽題快速刷。'}
      </p>
      {err && <div className="mt-4 rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{err}</div>}

      <div className="mt-6 space-y-4">
        <div>
          <label className={label}>職類</label>
          <select className={sel} value={prof} onChange={(e) => { setProf(e.target.value); setCode(''); setSub(''); setSubShort(''); }}>
            <option value="">請選擇…</option>
            {profs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {variant !== 'random' && prof && (
          <div>
            <label className={label}>年度／場次</label>
            <select className={sel} value={code} onChange={(e) => { setCode(e.target.value); setSub(''); }}>
              <option value="">請選擇…</option>
              {exams.map(([c, e]) => <option key={c} value={c}>{e.minguo}年{e.session}</option>)}
            </select>
          </div>
        )}

        {variant !== 'random' && variant === 'mock' && code && (
          <p className="text-sm text-slate-500">將考整場（{subjects.length} 科，限時）。若只想考單科，請用練習模式。</p>
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

      <button
        disabled={loading || (variant === 'random' ? !subShort : variant === 'mock' ? !code : !sub)}
        onClick={() => {
          if (variant === 'random') runRandom();
          else if (variant === 'mock') { if (sub) autoRun(idx!, prof, code, sub); else autoRunExam(idx!, prof, code); }
          else autoRun(idx!, prof, code, sub);
        }}
        className="mt-7 w-full rounded-xl bg-brand-600 text-white font-semibold py-3 hover:bg-brand-700 disabled:opacity-40 transition">
        {loading ? '載入中…' : variant === 'mock' ? '開始考試' : '開始'}
      </button>
    </div>
  );
}
