import { useEffect, useRef, useState } from 'react';
import { getAttempts, getWrong, getMarks, clearAttempts, removeAttempt, exportAll, importAll, type Attempt } from '../lib/store';
import { fetchSubject } from '../lib/client';
import { PROF_SLUG } from '../lib/types';
import Quiz, { type QuizItem } from './Quiz';
import Icon from './Icon';

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

  // 刪除單筆作答紀錄：多次確認。錯誤題目的全站統計在伺服器端，不受此影響。
  function deleteOne(a: Attempt) {
    if (!confirm(`確定要刪除這筆紀錄嗎？\n\n「${a.title}」\n${fmtDate(a.ts)}`)) return;
    if (!confirm('刪除後無法復原，確定刪除？')) return;
    removeAttempt(a.id);
    setAttempts(getAttempts());
    setMsg('已刪除 1 筆作答紀錄（全站錯誤率統計不受影響）。');
  }

  // 清除全部：兩次確認 + 輸入驗證
  function clearAll() {
    if (!confirm('確定要清除「全部」作答紀錄嗎？此動作無法復原。')) return;
    if (!confirm('再次確認：這會刪除你在此裝置上的所有作答紀錄。')) return;
    const typed = prompt('最後一步：請輸入「刪除」兩字以確認清除全部紀錄。');
    if (typed !== '刪除') { setMsg('已取消清除。'); return; }
    clearAttempts();
    setAttempts([]);
    setMsg('已清除全部作答紀錄（全站錯誤率統計不受影響）。');
  }

  function doExport() {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url; a.download = `醫事國考題庫紀錄_${d.getFullYear()}${d2(d.getMonth() + 1)}${d2(d.getDate())}.json`;
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
        <button onClick={doExport} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium hover:border-brand-400"><Icon name="download" className="w-4 h-4" />匯出紀錄</button>
        <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium hover:border-brand-400"><Icon name="upload" className="w-4 h-4" />匯入紀錄</button>
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
          {attempts.map((a) => {
            const wrongN = a.answered - a.correct;   // 已作答中答錯的題數
            const blankN = a.total - a.answered;      // 未作答
            return (
              <div key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center gap-4">
                <div className="text-center shrink-0 w-14">
                  <div className="text-2xl font-extrabold text-brand-600 dark:text-brand-400">{Math.round((a.correct / a.total) * 100)}<span className="text-sm">分</span></div>
                  <div className="text-xs text-slate-400">{a.correct}/{a.total}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-white truncate">{a.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400">答對 {a.correct}</span>
                    <span className="text-rose-600 dark:text-rose-400">答錯 {wrongN}</span>
                    {blankN > 0 && <span className="text-slate-400">未作答 {blankN}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">{fmtDate(a.ts)}．{a.mode === 'mock' ? '模擬考' : a.mode === 'random' ? '隨機' : '練習'}{a.durationSec ? `．${Math.round(a.durationSec / 60)} 分鐘` : ''}</div>
                </div>
                <button onClick={() => deleteOne(a)} aria-label="刪除這筆紀錄"
                  className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            );
          })}
          {attempts.length > 0 && (
            <div className="pt-2">
              <button onClick={clearAll} className="text-sm text-rose-500 hover:underline">清除全部紀錄</button>
              <p className="mt-1 text-xs text-slate-400">刪除紀錄只會移除你裝置上的作答歷程；用於排行榜的全站錯誤率統計為匿名彙總，不受影響。</p>
            </div>
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
                    <Icon name="x" className="w-4 h-4 text-rose-500 shrink-0" />
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
          {markList.length === 0 ? <Empty text="還沒有收藏題目，作答時點星號即可收藏。" /> : (
            <>
              <button onClick={() => launch(markList as any, `收藏複習（${markList.length}）`)}
                className="mb-4 rounded-lg bg-brand-600 text-white font-semibold px-4 py-2 hover:bg-brand-700">複習收藏（{markList.length}）</button>
              <ul className="space-y-2 text-sm">
                {markList.map((m: any, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center gap-2">
                    <Icon name="star" className="w-4 h-4 text-amber-400 shrink-0" fill />
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
