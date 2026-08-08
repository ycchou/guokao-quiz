import Icon from './Icon';

// 詳解區塊（練習/模擬考檢討用）。explanation 為空時顯示「暫無解析」。
export default function Explanation({ text }: { text?: string | null }) {
  if (!text) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-400">
        此題暫無解析，之後會陸續補上。
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-brand-100 dark:border-slate-700 bg-brand-50/60 dark:bg-slate-800/60 p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
        <Icon name="info" className="w-4 h-4" />詳解
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{text}</p>
      <p className="mt-2 text-xs text-slate-400">AI 輔助解析，僅供參考，以考選部公告之標準答案／更正答案為準。</p>
    </div>
  );
}
