import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question } from '../lib/types';
import { saveAttempt, toggleMark, isMarked, type Attempt } from '../lib/store';
import { reportAnswers } from '../lib/client';
import Icon from './Icon';
import Explanation from './Explanation';

export interface QuizItem extends Question {
  prof: string;
  file: string;
  subjectShort?: string;
  srcLabel?: string;
  srcHref?: string;
}
export interface QuizResult {
  total: number;
  correct: number;
  answered: number;
  durationSec: number;
  items: QuizItem[];
  picked: Record<number, string>;
}
interface Props {
  items: QuizItem[];
  title: string;
  mode: 'practice' | 'mock' | 'random';
  timeLimitSec?: number;
  dataBase?: string;
  /** 交卷時回呼；提供時由父層決定後續（不顯示內建結算畫面） */
  onFinish?: (r: QuizResult) => void;
  /** 是否把此次作答存入紀錄（預設 true） */
  save?: boolean;
}

const LETTERS = ['A', 'B', 'C', 'D'];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Quiz({ items, title, mode, timeLimitSec, dataBase = '', onFinish, save = true }: Props) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [left, setLeft] = useState(timeLimitSec ?? 0);
  const [marks, setMarks] = useState<Record<number, boolean>>({});
  const startRef = useRef(Date.now());

  const q = items[idx];

  useEffect(() => {
    const m: Record<number, boolean> = {};
    items.forEach((it, i) => { m[i] = isMarked(it.prof, it.file, it.no); });
    setMarks(m);
    setIdx(0); setPicked({}); setSubmitted(false); setLeft(timeLimitSec ?? 0); startRef.current = Date.now();
  }, [items]);

  useEffect(() => {
    if (!timeLimitSec || submitted) return;
    const t = setInterval(() => {
      setLeft((s) => { if (s <= 1) { clearInterval(t); finish(); return 0; } return s - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [timeLimitSec, submitted]);

  const optionsFor = (question: Question): string[] =>
    question.options && Object.keys(question.options).length ? Object.keys(question.options).sort() : LETTERS;

  function choose(letter: string) {
    if (submitted) return;
    setPicked((p) => ({ ...p, [q.no]: letter }));
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
    if (save) {
      const attempt: Attempt = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        mode, title, ts: Date.now(),
        total: items.length, correct: stats.correct, answered: stats.answered, durationSec,
        items: items.map((it) => ({
          prof: it.prof, file: it.file, no: it.no,
          picked: picked[it.no] ?? null, answer: it.answer,
          correct: !!(picked[it.no] && it.answer && picked[it.no] === it.answer),
        })),
      };
      saveAttempt(attempt);
    }
    // 匿名回報作答結果（僅已作答題），供全站統計與錯誤率排名
    reportAnswers(items.filter((it) => picked[it.no]).map((it) => ({
      qid: `${it.prof}|${it.file}|${it.no}`,
      prof: it.prof,
      subject: it.subjectShort || '',
      correct: !!(it.answer && picked[it.no] === it.answer),
    })));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    onFinish?.({ total: items.length, correct: stats.correct, answered: stats.answered, durationSec, items, picked });
  }

  function toggleStar() {
    const on = toggleMark(q.prof, q.file, q.no);
    setMarks((m) => ({ ...m, [idx]: on }));
  }

  // 交卷後：若父層接手（onFinish）則不顯示內建結算
  if (submitted && onFinish) return null;

  if (submitted) {
    return <Results items={items} picked={picked} stats={stats} title={title} dataBase={dataBase}
      onRedo={() => { setSubmitted(false); setIdx(0); setPicked({}); setLeft(timeLimitSec ?? 0); startRef.current = Date.now(); }} />;
  }

  const chosen = picked[q.no];
  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <div className="flex items-center gap-3 mb-3">
        <h1 className="font-bold text-slate-900 dark:text-white truncate">{title}</h1>
        {timeLimitSec != null && (
          <span className={`ml-auto tabular-nums font-mono px-2.5 py-1 rounded-lg text-sm ${left < 60 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 dark:bg-slate-800'}`}>⏱ {fmt(left)}</span>
        )}
        <span className={`text-sm text-slate-500 ${timeLimitSec != null ? '' : 'ml-auto'}`}>{stats.answered}/{items.length}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <span className="text-brand-600 dark:text-brand-400 font-bold">{q.no}.</span>
          <div className="flex-1 min-w-0">
            {q.stem && <p className="q-stem font-medium text-slate-900 dark:text-white text-[15px]">{q.stem}</p>}
            {q.mode === 'image' && q.img && <img src={`${dataBase}/data/${q.img}`} alt={`第 ${q.no} 題`} className="mt-2 max-w-full rounded-lg border border-slate-200 dark:border-slate-700" />}
            {q.mode === 'text_uncertain' && <p className="mt-1 text-xs text-amber-600">此題自動解析可能不完整，可交卷後對照原始 PDF。</p>}
          </div>
          <button onClick={toggleStar} title="收藏" aria-label="收藏此題" className="shrink-0 p-1">
            <Icon name="star" className={`w-5 h-5 ${marks[idx] ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'}`} fill={marks[idx]} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {optionsFor(q).map((L) => {
            const isPick = chosen === L;
            return (
              <button key={L} onClick={() => choose(L)}
                className={`w-full text-left flex gap-3 rounded-xl border px-3.5 py-2.5 transition ${isPick ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/25' : 'border-slate-200 dark:border-slate-700 hover:border-brand-400'}`}>
                <span className="font-bold shrink-0">{L}</span>
                <span className="text-[15px]">{q.options?.[L] ?? '（此題為圖片，請看上方圖片作答）'}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
          className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 disabled:opacity-40 hover:border-brand-400">上一題</button>
        {idx < items.length - 1 ? (
          <button onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))}
            className="rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700 flex-1">下一題</button>
        ) : (
          <button onClick={confirmFinish} className="rounded-lg bg-emerald-600 text-white font-semibold px-4 py-2 hover:bg-emerald-700 flex-1">交卷</button>
        )}
        <button onClick={confirmFinish} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm hover:border-brand-400" title="直接交卷">交卷</button>
      </div>

      <div className="mt-5 grid grid-cols-8 sm:grid-cols-10 gap-1.5">
        {items.map((it, i) => {
          const p = picked[it.no];
          let c = p ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500';
          if (i === idx) c += ' ring-2 ring-brand-400 ring-offset-1 dark:ring-offset-slate-950';
          return <button key={i} onClick={() => setIdx(i)} className={`h-8 rounded-md text-xs font-medium ${c}`}>{i + 1}</button>;
        })}
      </div>
    </div>
  );

  function confirmFinish() {
    const un = items.length - stats.answered;
    if (un > 0 && !confirm(`還有 ${un} 題未作答，確定要交卷嗎？`)) return;
    finish();
  }
}

// ---------- 結算畫面（練習／隨機用；模考由父層 MockRunner 處理） ----------
function Results({ items, picked, stats, title, dataBase, onRedo }: {
  items: QuizItem[]; picked: Record<number, string>; stats: { correct: number; answered: number };
  title: string; dataBase: string; onRedo: () => void;
}) {
  const wrong = items.filter((it) => !(picked[it.no] && it.answer && picked[it.no] === it.answer));
  const pct = Math.round((stats.correct / items.length) * 100);
  const opt = (q: Question) => q.options && Object.keys(q.options).length ? Object.keys(q.options).sort() : ['A', 'B', 'C', 'D'];
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
        <div className="text-sm text-slate-500">{title}</div>
        <div className="mt-2 text-5xl font-extrabold text-brand-600 dark:text-brand-400">{stats.correct}<span className="text-2xl text-slate-400">/{items.length}</span></div>
        <div className="mt-1 text-slate-500">答對率 {pct}%．作答 {stats.answered} 題</div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button onClick={onRedo} className="rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700">再做一次</button>
          <a href="/records" className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-semibold hover:border-brand-400">查看紀錄</a>
        </div>
      </div>
      <h3 className="mt-8 mb-3 font-bold text-slate-900 dark:text-white">
        {wrong.length ? `錯題與詳解（${wrong.length}）` : '本次全部答對'}
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
                  {opt(it).map((L) => {
                    const isAns = it.answer === L, isPick = picked[it.no] === L;
                    return (
                      <div key={L} className={`flex gap-2 rounded px-2 py-1 ${isAns ? 'bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300' : isPick ? 'bg-rose-50 dark:bg-rose-900/25 text-rose-700 dark:text-rose-300' : ''}`}>
                        <b>{L}.</b><span>{it.options?.[L] ?? ''}</span>
                        {isAns && <span className="ml-auto flex items-center gap-1"><Icon name="check" className="w-4 h-4" />正解</span>}
                        {isPick && !isAns && <span className="ml-auto">你的選擇</span>}
                      </div>
                    );
                  })}
                </div>
                {it.corrected && <span className="inline-block mt-2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-xs">更正答案</span>}
                {it.srcHref && <a href={it.srcHref} className="inline-block mt-2 ml-2 text-xs text-slate-400 underline hover:text-brand-600">出處：{it.srcLabel}</a>}
                <Explanation text={it.explanation} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
