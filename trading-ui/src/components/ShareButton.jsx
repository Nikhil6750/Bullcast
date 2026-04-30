import { useState, useRef } from "react";
import html2canvas from "html2canvas";

export default function ShareButton({ data }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const previewRef = useRef(null);

  const showToast = () => {
    setToast(true);
    setTimeout(() => setToast(false), 2500);
    setOpen(false);
  };

  const handleCopyText = async () => {
    const text = `${data.stock} is ${data.sentiment} today 📊\nScore: ${data.score}/100\n\nPositive: ${data.positive_pct}%  Neutral: ${data.neutral_pct}%  Negative: ${data.negative_pct}%\n\nChecked on Bullcast — free stock sentiment tracker\nbullcast.app`;
    try {
      await navigator.clipboard.writeText(text);
      showToast();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyImage = async () => {
    if (!previewRef.current) return;
    try {
      const canvas = await html2canvas(previewRef.current, { backgroundColor: "#060608", scale: 2 });
      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            showToast();
          } catch (e) {
            console.error("Image copy not supported, falling back to text", e);
            handleCopyText();
          }
        }
      });
    } catch (err) {
      console.error(err);
      handleCopyText();
    }
  };

  return (
    <div className="relative inline-block w-full">
      {!open ? (
        <button 
          onClick={() => setOpen(true)} 
          className="w-full px-4 py-3 bg-card border border-border text-white hover:bg-border font-mono text-xs uppercase tracking-widest transition-colors flex justify-between items-center"
        >
          <span>Send to group</span>
          <span className="text-primary">&rarr;</span>
        </button>
      ) : (
        <div className="animate-[fade-in-up_0.2s_ease-out] border border-border bg-card p-4 flex flex-col gap-4 relative z-10 w-full shadow-2xl">
          <div className="flex justify-between items-center border-b border-border pb-2">
            <span className="font-mono text-[10px] text-neutral-400 uppercase">Share Report</span>
            <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-white">&times;</button>
          </div>
          
          <div ref={previewRef} className="bg-background border border-border p-4 w-full">
            <div className="font-display text-primary tracking-widest text-lg mb-4 leading-none">BULLCAST</div>
            <div className="flex justify-between items-end mb-4">
              <div className="font-display text-4xl text-white tracking-widest leading-none">{data.stock}</div>
              <div className={`font-mono text-[10px] tracking-widest border px-2 py-0.5 ${data.sentiment === "BULLISH" ? "text-bullish border-bullish bg-bullish/10" : data.sentiment === "BEARISH" ? "text-bearish border-bearish bg-bearish/10" : "text-neutral-400 border-muted bg-muted/10"}`}>
                {data.sentiment}
              </div>
            </div>
            
            <div className="flex justify-between items-end font-mono mb-2">
              <span className="text-neutral-400 text-[10px] uppercase tracking-widest">Score</span>
              <span className="text-white text-base leading-none">{data.score}<span className="text-[10px] text-neutral-400">/100</span></span>
            </div>
            <div className="w-full h-1 bg-border flex mb-4">
              <div className={`h-full ${data.sentiment === "BULLISH" ? "bg-bullish" : data.sentiment === "BEARISH" ? "bg-bearish" : "bg-muted"}`} style={{ width: `${data.score}%` }}></div>
            </div>
            
            <div className="flex justify-between font-mono text-[10px] text-neutral-400 tracking-widest uppercase mb-4">
              <span>POS: <span className="text-bullish">{data.positive_pct}%</span></span>
              <span>NEU: <span className="text-white">{data.neutral_pct}%</span></span>
              <span>NEG: <span className="text-bearish">{data.negative_pct}%</span></span>
            </div>
            <div className="text-[9px] text-neutral-600 font-mono text-center pt-2 border-t border-border border-dashed">
              bullcast.app
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleCopyText} className="flex-1 py-2 border border-muted text-white hover:border-white font-mono text-[10px] uppercase tracking-widest transition-colors">
              Copy Text
            </button>
            <button onClick={handleCopyImage} className="flex-1 py-2 bg-primary text-black hover:bg-primary/80 font-mono text-[10px] uppercase tracking-widest transition-colors font-bold">
              Copy Image
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-primary text-black font-mono text-xs uppercase tracking-widest px-6 py-3 shadow-[0_0_20px_rgba(200,241,53,0.3)] animate-[fade-in-up_0.3s_ease-out] z-50">
          Copied. Share it anywhere.
        </div>
      )}
    </div>
  );
}
