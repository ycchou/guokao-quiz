import { useEffect, useRef, useState } from 'react';
import { getAttempts, getWrong, getMarks, clearAttempts, exportAll, importAll, type Attempt } from '../lib/store';
import { fetchSubject } from '../lib/client';
import { PROF_SLUG } from '../lib/types';
import Quiz, { type QuizItem } from './Quiz';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
type Tab = 'history' | 'wrong' | 'marks';
const d2 = (n: number) => String(n).padStart(2, '0');
const fmtDate = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${d2(d.getHours())}:${d2(d.getMinutes())}`; };

export default function RecordsApp() {
  const [tab, setTab] = useState<Tab>('history');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [wrong, setWrong] = useState<Record<string, any>>({});
  const [marks, setMarks] = useState<Record<string, any>>({});
  const [runItems, setRunItems] = useState<QuizItem[] | null>(null);
  const [runTitle, setRunTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() { setAttempts(getAttempts()); setWrong(getWrong()); setMarks(getMarks()); }
  useEffect(() => { refresh(); }, []);

  function doExport() {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url; a.download = `國考題庫紀錄_${d.getFullYear()}${d2(d.getMonth() + 1)}${d2(d.getDate())}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
  function doImport(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const merge = !confirm('要「取代」現有紀錄嗎？\n\n按「確定」＝取代（清空後匯入）\n按「取消」＝合併（保留現有並加入）');
        const r = importAll(data, merge ? 'merge' : 'replace');
        refresh();
        setMsg(`匯入完成：作答 ${r.attempts} 筆、錯題 ${r.wrong} 題、收藏 ${r.marks} 題`);
      } catch (e: any) { setMsg('匯入失敗：' + (e?.message || '檔案無法解析')); }
    };
    reader.readAsText(file);
  }

  async function launch(keys: { prof: string; file: string; no: number }[], title: string) {
    setLoading(true);
    const byFile = new Map<string, { prof: string; file: string; nos: Set<number> }>();
    for (const k of keys) {
      const id = `${k.prof}|${k.file}`;
      if (!byFile.has(id)) byFile.set(id, { prof: k.prof, file: k.file, nos: new Set() });
      byFile.get(id)!.nos.add(k.no);
    }
    const items: QuizItem[] = [];
    for (const { prof, file, nos } of byFile.values()) {
      try {
        const s = await fetchSubject(prof, file);
        const href = `${base}/${PROF_SLUG[prof]}/${s.examCode}/${s.subjectNo}`;
        const lab = `${prof} ${s.minguo}年${s.session} ${s.subjectShort}`;
        for (const q of s.questions)
          if (nos.has(q.no) && q.mode !== 'scanned')
            items.push({ ...q, prof, file, subjectShort: s.subjectShort, srcLabel: lab, srcHref: href });
      } catch { /* skip */ }
    }
    setLoading(false);
    if (items.length) { setRunItems(items); setRunTitle(title); }
  }

  if (runItems) return <Quiz items={runItems} title={runTitle} mode="practice" dataBase={base} />;

  const wrongList = Object.values(wrong);
  const markList = Object.values(marks);
  const tabs: [Tab, string, number][] = [
    ['history', '作答紀錄', attempts.length],
    ['wrong', '錯題本', wrongList.length],
    ['marks', '收藏', markList.length],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900 dark:text-white">我的紀錄</h1>
      <p className="mt-1 text-sm text-slate-500">紀錄僅儲存在你目前的裝置瀏覽器，不會上傳。可匯出備份或換裝置時匯入。</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={doExport} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium hover:border-brand-400">⬇ 匯出紀錄</button>
        <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium hover:border-brand-400">⬆ 匯入紀錄</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      </div>
      {msg && <div className="mt-2 text-sm rounded-lg bg-brand-50 dark:bg-slate-800 text-brand-700 dark:text-brand-300 px-3 py-2">{msg}</div>}

      <div className="mt-5 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map(([t, name, n]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {name} <span className="text-xs">({n})</span>
          </button>
        ))}
      </div>

      {loading && <p className="mt-6 text-slate-500">載入中…</p>}

      {tab === 'history' && (
        <div className="mt-5 space-y-3">
          {attempts.length === 0 && <Empty text="還沒有作答紀錄，先去練習吧！" />}
          {attempts.map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center gap-4">
              <div className="text-center shrink-0">
                <div className="text-2xl font-extrabold text-brand-600 dark:text-brand-400">{Math.round((a.correct / a.total) * 100)}%</div>
                <div className="text-xs text-slate-400">{a.correct}/{a.total}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 dark:text-white truncate">{a.title}</div>
                <div className="text-xs text-slate-400">{fmtDate(a.ts)}．{a.mode === 'mock' ? '模擬考' : a.mode === 'random' ? '隨機' : '練習'}{a.durationSec ? `．${Math.round(a.durationSec / 60)} 分鐘` : ''}</div>
              </div>
            </div>
          ))}
          {attempts.length > 0 && (
            <button onClick={() => { if (confirm('確定清除所有作答紀錄？')) { clearAttempts(); setAttempts([]); } }}
              className="text-sm text-rose-500 hover:underline">清除全部紀錄</button>
          )}
        </div>
      )}

      {tab === 'wrong' && (
        <div className="mt-5">
          {wrongList.length === 0 ? <Empty text="錯題本是空的，答錯的題目會自動收錄在這裡（答對後移除）。" /> : (
            <>
              <button onClick={() => launch(wrongList as any, `錯題重做（${wrongList.length}）`)}
                className="mb-4 rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700">重做全部錯題（{wrongList.length}）</button>
              <ul className="space-y-2 text-sm">
                {wrongList.slice(0, 100).map((w: any, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center gap-2">
                    <span className="text-rose-500">✗</span>
                    <span className="text-slate-500">{w.prof}．第 {w.no} 題</span>
                    <span className="ml-auto text-xs text-slate-400">你選 {w.picked}／正解 {w.answer}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'marks' && (
        <div className="mt-5">
          {markList.length === 0 ? <Empty text="還沒有收藏題目，作答時點 ☆ 即可收藏。" /> : (
            <>
              <button onClick={() => launch(markList as any, `收藏複習（${markList.length}）`)}
                className="mb-4 rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700">複習收藏（{markList.length}）</button>
              <ul className="space-y-2 text-sm">
                {markList.map((m: any, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center gap-2">
                    <span className="text-amber-400">★</span>
                    <span className="text-slate-500">{m.prof}．第 {m.no} 題</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mt-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-400">{text}</div>;
}
