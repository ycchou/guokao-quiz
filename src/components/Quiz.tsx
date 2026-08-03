import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '../lib/types';
import { saveAttempt, toggleMark, isMarked, type Attempt } from '../lib/store';

export interface QuizItem extends Question {
  prof: string;
  file: string;
  srcLabel?: string; // e.g. "護理師 114年第一次 基礎醫學"
  srcHref?: string;  // link to public Q&A page
}
interface Props {
  items: QuizItem[];
  title: string;
  mode: 'practice' | 'mock' | 'random';
  timeLimitSec?: number;
  dataBase?: string;
}

const LETTERS = ['A', 'B', 'C', 'D'];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Quiz({ items, title, mode, timeLimitSec, dataBase = '' }: Props) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [left, setLeft] = useState(timeLimitSec ?? 0);
  const [marks, setMarks] = useState<Record<number, boolean>>({});
  const startRef = useRef(Date.now());
  const gridRef = useRef<HTMLDivElement>(null);

  const immediate = mode !== 'mock';
  const q = items[idx];

  useEffect(() => {
    const m: Record<number, boolean> = {};
    items.forEach((it, i) => { m[i] = isMarked(it.prof, it.file, it.no); });
    setMarks(m);
  }, [items]);

  useEffect(() => {
    if (!timeLimitSec || submitted) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { clearInterval(t); finish(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timeLimitSec, submitted]);

  const optionsFor = (question: Question): string[] =>
    question.options && Object.keys(question.options).length
      ? Object.keys(question.options).sort()
      : LETTERS; // image/scanned questions: default A-D buttons

  function choose(letter: string) {
    if (submitted) return;
    if (immediate && revealed.has(q.no)) return; // locked after reveal in practice
    setPicked((p) => ({ ...p, [q.no]: letter }));
    if (immediate) setRevealed((r) => new Set(r).add(q.no));
  }

  const stats = useMemo(() => {
    let correct = 0, answered = 0;
    for (const it of items) {
      const p = picked[it.no];
      if (p) answered++;
      if (p && it.answer && p === it.answer) correct++;
    }
    return { correct, answered };
  }, [picked, items]);

  function finish() {
    if (submitted) return;
    setSubmitted(true);
    const durationSec = Math.round((Date.now() - startRef.current) / 1000);
    const attempt: Attempt = {
      id: `${Date.now()}`,
      mode, title, ts: Date.now(),
      total: items.length, correct: stats.correct, answered: stats.answered, durationSec,
      items: items.map((it) => ({
        prof: it.prof, file: it.file, no: it.no,
        picked: picked[it.no] ?? null, answer: it.answer,
        correct: !!(picked[it.no] && it.answer && picked[it.no] === it.answer),
      })),
    };
    saveAttempt(attempt);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleStar() {
    const on = toggleMark(q.prof, q.file, q.no);
    setMarks((m) => ({ ...m, [idx]: on }));
  }

  // ---------- results ----------
  if (submitted) {
    const wrong = items.filter((it) => !(picked[it.no] && it.answer && picked[it.no] === it.answer));
    const pct = Math.round((stats.correct / items.length) * 100);
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-2 text-5xl font-extrabold text-brand-600 dark:text-brand-400">{stats.correct}<span className="text-2xl text-slate-400">/{items.length}</span></div>
          <div className="mt-1 text-slate-500">答對率 {pct}%．作答 {stats.answered} 題</div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={() => { setSubmitted(false); setIdx(0); setPicked({}); setRevealed(new Set()); setLeft(timeLimitSec ?? 0); startRef.current = Date.now(); }} className="rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700">再做一次</button>
            <a href="/records" className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold hover:border-brand-400">查看紀錄</a>
          </div>
        </div>

        <h3 className="mt-8 mb-3 font-bold text-slate-900 dark:text-white">
          {wrong.length ? `錯題與詳解（${wrong.length}）` : '全部答對，太強了 🎉'}
        </h3>
        <ol className="space-y-4">
          {wrong.map((it) => (
            <li key={it.no} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="flex gap-2">
                <span className="font-bold text-slate-400">{it.no}.</span>
                <div className="flex-1 min-w-0">
                  {it.stem && <p className="font-medium text-slate-900 dark:text-white">{it.stem}</p>}
                  {it.mode === 'image' && it.img && <img src={`${dataBase}/data/${it.img}`} className="mt-2 max-w-full rounded-lg border border-slate-200 dark:border-slate-700" />}
                  <div className="mt-2 space-y-1 text-sm">
                    {optionsFor(it).map((L) => {
                      const isAns = it.answer === L;
                      const isPick = picked[it.no] === L;
                      return (
                        <div key={L} className={`flex gap-2 rounded px-2 py-1 ${isAns ? 'bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300' : isPick ? 'bg-rose-50 dark:bg-rose-900/25 text-rose-700 dark:text-rose-300' : ''}`}>
                          <b>{L}.</b><span>{it.options?.[L] ?? ''}</span>
                          {isAns && <span className="ml-auto">✓ 正解</span>}
                          {isPick && !isAns && <span className="ml-auto">你的選擇</span>}
                        </div>
                      );
                    })}
                  </div>
                  {it.corrected && <span className="inline-block mt-2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-xs">更正答案</span>}
                  {it.srcHref && <a href={it.srcHref} className="inline-block mt-2 ml-2 text-xs text-slate-400 underline hover:text-brand-600">出處：{it.srcLabel}</a>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // ---------- quiz runner ----------
  const chosen = picked[q.no];
  const showAns = immediate && revealed.has(q.no);
  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <div className="flex items-center gap-3 mb-3">
        <h1 className="font-bold text-slate-900 dark:text-white truncate">{title}</h1>
        {timeLimitSec != null && (
          <span className={`ml-auto tabular-nums font-mono px-2.5 py-1 rounded-lg text-sm ${left < 60 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 dark:bg-slate-800'}`}>⏱ {fmt(left)}</span>
        )}
        <span className={`text-sm text-slate-500 ${timeLimitSec != null ? '' : 'ml-auto'}`}>{stats.answered}/{items.length}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <span className="text-brand-600 dark:text-brand-400 font-bold">{q.no}.</span>
          <div className="flex-1 min-w-0">
            {q.stem && <p className="q-stem font-medium text-slate-900 dark:text-white text-[15px]">{q.stem}</p>}
            {q.mode === 'image' && q.img && <img src={`${dataBase}/data/${q.img}`} alt={`第 ${q.no} 題`} className="mt-2 max-w-full rounded-lg border border-slate-200 dark:border-slate-700" />}
            {q.mode === 'text_uncertain' && <p className="mt-1 text-xs text-amber-600">此題自動解析可能不完整，作答後可對照原始 PDF。</p>}
          </div>
          <button onClick={toggleStar} title="收藏" className="shrink-0 p-1 text-xl leading-none">
            <span className={marks[idx] ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'}>{marks[idx] ? '★' : '☆'}</span>
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {optionsFor(q).map((L) => {
            const isPick = chosen === L;
            const isAns = q.answer === L;
            let cls = 'border-slate-200 dark:border-slate-700 hover:border-brand-400';
            if (showAns) {
              if (isAns) cls = 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/25';
              else if (isPick) cls = 'border-rose-400 bg-rose-50 dark:bg-rose-900/25';
            } else if (isPick) cls = 'border-brand-500 bg-brand-50 dark:bg-brand-900/25';
            return (
              <button key={L} onClick={() => choose(L)} disabled={showAns}
                className={`w-full text-left flex gap-3 rounded-xl border px-3.5 py-2.5 transition ${cls}`}>
                <span className="font-bold shrink-0">{L}</span>
                <span className="text-[15px]">{q.options?.[L] ?? '（此題為圖片，請看上方圖片作答）'}</span>
                {showAns && isAns && <span className="ml-auto text-emerald-600 text-sm shrink-0">✓</span>}
                {showAns && isPick && !isAns && <span className="ml-auto text-rose-600 text-sm shrink-0">✗</span>}
              </button>
            );
          })}
        </div>

        {showAns && (
          <div className="mt-3 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
            正確答案：<b className="text-emerald-600 dark:text-emerald-400">{q.answer ?? '—'}</b>
            {q.corrected && <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-xs">更正答案</span>}
            {q.note && <span className="ml-2 text-slate-400">{q.note}</span>}
            {q.srcHref && <a href={q.srcHref} className="ml-2 text-slate-400 underline hover:text-brand-600">出處</a>}
          </div>
        )}
      </div>

      {/* nav */}
      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
          className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 disabled:opacity-40 hover:border-brand-400">上一題</button>
        {idx < items.length - 1 ? (
          <button onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))}
            className="rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700 flex-1">下一題</button>
        ) : (
          <button onClick={finish} className="rounded-lg bg-emerald-600 text-white font-semibold px-4 py-2 hover:bg-emerald-700 flex-1">交卷看成績</button>
        )}
        <button onClick={finish} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm hover:border-brand-400" title="直接交卷">交卷</button>
      </div>

      {/* question grid */}
      <div ref={gridRef} className="mt-5 grid grid-cols-8 sm:grid-cols-10 gap-1.5">
        {items.map((it, i) => {
          const p = picked[it.no];
          const rev = immediate && revealed.has(it.no);
          let c = 'bg-slate-100 dark:bg-slate-800 text-slate-500';
          if (rev && p) c = p === it.answer ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white';
          else if (p) c = 'bg-brand-500 text-white';
          if (i === idx) c += ' ring-2 ring-brand-400 ring-offset-1 dark:ring-offset-slate-950';
          return (
            <button key={i} onClick={() => setIdx(i)} className={`h-8 rounded-md text-xs font-medium ${c}`}>{it.no}</button>
          );
        })}
      </div>
    </div>
  );
}
