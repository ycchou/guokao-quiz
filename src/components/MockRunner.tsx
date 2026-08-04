import { useState } from 'react';
import Quiz, { type QuizItem, type QuizResult } from './Quiz';

export interface MockSession {
  label: string;      // 科目短名
  fullLabel: string;  // 完整標題
  items: QuizItem[];
  timeLimitSec: number;
}
interface Props {
  title: string;               // 考試名稱
  sessions: MockSession[];
  scoring: 'each' | 'end';     // 交卷即算分 / 全部考完再算
  dataBase?: string;
}

export default function MockRunner({ title, sessions, scoring, dataBase = '' }: Props) {
  const [cur, setCur] = useState(0);
  const [phase, setPhase] = useState<'running' | 'interlude' | 'done'>('running');
  const [results, setResults] = useState<(QuizResult | null)[]>(() => sessions.map(() => null));

  const isLast = cur >= sessions.length - 1;

  function handleFinish(r: QuizResult) {
    setResults((rs) => { const c = rs.slice(); c[cur] = r; return c; });
    if (isLast) setPhase('done');
    else if (scoring === 'each') setPhase('interlude');
    else { setCur((c) => c + 1); setPhase('running'); }
  }
  function next() { setCur((c) => c + 1); setPhase('running'); window.scrollTo({ top: 0 }); }

  if (phase === 'done') return <MockSummary title={title} sessions={sessions} results={results} dataBase={dataBase} />;

  if (phase === 'interlude') {
    const r = results[cur]!;
    const s = sessions[cur];
    const pct = Math.round((r.correct / r.total) * 100);
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <div className="text-sm text-slate-500">{s.label}．已交卷</div>
          <div className="mt-2 text-4xl font-extrabold text-brand-600 dark:text-brand-400">{r.correct}<span className="text-xl text-slate-400">/{r.total}</span></div>
          <div className="mt-1 text-slate-500">答對率 {pct}%</div>
          <p className="mt-4 text-sm text-slate-500">已完成 {cur + 1} / {sessions.length} 科</p>
          <button onClick={next} className="mt-5 w-full rounded-xl bg-brand-600 text-white font-semibold py-3 hover:bg-brand-700">
            進入下一科：{sessions[cur + 1].label} →
          </button>
        </div>
      </div>
    );
  }

  const s = sessions[cur];
  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <div className="rounded-xl bg-brand-50 dark:bg-slate-900 border border-brand-100 dark:border-slate-800 px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-brand-700 dark:text-brand-300">模擬考</span>
          <span className="text-slate-500">{title}</span>
          <span className="ml-auto text-slate-500">第 {cur + 1}/{sessions.length} 科．{scoring === 'each' ? '交卷即算分' : '全部考完再算分'}</span>
        </div>
      </div>
      <Quiz key={cur} items={s.items} title={`${s.label}（限時 ${Math.round(s.timeLimitSec / 60)} 分）`}
        mode="mock" timeLimitSec={s.timeLimitSec} dataBase={dataBase} onFinish={handleFinish} />
    </div>
  );
}

function MockSummary({ title, sessions, results, dataBase }: {
  title: string; sessions: MockSession[]; results: (QuizResult | null)[]; dataBase: string;
}) {
  const done = results.map((r, i) => ({ r, s: sessions[i] })).filter((x) => x.r);
  const totalQ = done.reduce((a, x) => a + x.r!.total, 0);
  const totalC = done.reduce((a, x) => a + x.r!.correct, 0);
  const pct = totalQ ? Math.round((totalC / totalQ) * 100) : 0;
  const [openWrong, setOpenWrong] = useState(false);
  const allWrong = done.flatMap((x) => x.r!.items.filter((it) => !(x.r!.picked[it.no] && it.answer && x.r!.picked[it.no] === it.answer)));
  const opt = (q: any) => q.options && Object.keys(q.options).length ? Object.keys(q.options).sort() : ['A', 'B', 'C', 'D'];
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
        <div className="text-sm text-slate-500">模擬考完成．{title}</div>
        <div className="mt-2 text-5xl font-extrabold text-brand-600 dark:text-brand-400">{totalC}<span className="text-2xl text-slate-400">/{totalQ}</span></div>
        <div className="mt-1 text-slate-500">總答對率 {pct}%</div>
      </div>

      <div className="mt-6 space-y-2">
        {done.map(({ r, s }, i) => {
          const p = Math.round((r!.correct / r!.total) * 100);
          return (
            <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center gap-3">
              <span className="w-7 h-7 grid place-items-center rounded-lg bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-sm font-bold shrink-0">{i + 1}</span>
              <span className="font-medium text-slate-900 dark:text-white flex-1 min-w-0 truncate">{s.label}</span>
              <span className="text-sm text-slate-500">{r!.correct}/{r!.total}</span>
              <span className={`text-sm font-semibold ${p >= 60 ? 'text-emerald-600' : 'text-rose-600'}`}>{p}%</span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={() => setOpenWrong((v) => !v)} className="rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700">{openWrong ? '收合' : `檢視全部錯題（${allWrong.length}）`}</button>
        <a href="/mock" className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold hover:border-brand-400">再考一場</a>
        <a href="/records" className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold hover:border-brand-400">查看紀錄</a>
      </div>

      {openWrong && (
        <ol className="mt-5 space-y-4">
          {allWrong.map((it, k) => {
            const r = done.find((x) => x.r!.items.includes(it))!.r!;
            return (
              <li key={k} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="flex gap-2">
                  <span className="font-bold text-slate-400">{it.no}.</span>
                  <div className="flex-1 min-w-0">
                    {it.stem && <p className="font-medium text-slate-900 dark:text-white">{it.stem}</p>}
                    {it.mode === 'image' && it.img && <img src={`${dataBase}/data/${it.img}`} className="mt-2 max-w-full rounded-lg border border-slate-200 dark:border-slate-700" />}
                    <div className="mt-2 space-y-1 text-sm">
                      {opt(it).map((L) => {
                        const isAns = it.answer === L, isPick = r.picked[it.no] === L;
                        return (
                          <div key={L} className={`flex gap-2 rounded px-2 py-1 ${isAns ? 'bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300' : isPick ? 'bg-rose-50 dark:bg-rose-900/25 text-rose-700 dark:text-rose-300' : ''}`}>
                            <b>{L}.</b><span>{it.options?.[L] ?? ''}</span>
                            {isAns && <span className="ml-auto">✓ 正解</span>}
                            {isPick && !isAns && <span className="ml-auto">你的選擇</span>}
                          </div>
                        );
                      })}
                    </div>
                    {it.srcHref && <a href={it.srcHref} className="inline-block mt-2 text-xs text-slate-400 underline hover:text-brand-600">出處：{it.srcLabel}</a>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
