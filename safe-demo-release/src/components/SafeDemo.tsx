import { useState } from 'react';
import { ShieldCheck, FlaskConical, Play, RotateCcw, Eye, Heart, MessageCircle, Send, Bookmark, Repeat2, CheckCircle2, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { countComments, demoMinimums, demoQuantities, engagementTypes, type DemoValues } from '@/lib/safe-demo';
import '@/demo.css';
import { DemoPlanner } from './DemoPlanner';
import { defaultRatios, demoTiming, fillRatios, patterns, shapedQuantity, type Ratios } from '@/lib/demo-planning';
const icons: Record<typeof engagementTypes[number], typeof Eye> = { Views: Eye, Likes: Heart, Comments: MessageCircle, Shares: Send, Saves: Bookmark, Reposts: Repeat2 };
function createReport(q: DemoValues, m: DemoValues, runs: string, mode: string, reels: string, pattern: number, hours: number, drawn: number[], refill = false) {
  const seed = Math.floor(Math.random()*10000)+1;
  return { quantities: {...q}, minimums: {...m}, pattern, hours, refill, reels: mode === 'Mass' ? Number(reels) : 1, items: engagementTypes.map(type => ({type, ...shapedQuantity(q[type], m[type], Number(runs), pattern, seed, drawn)})) };
}
export function SafeDemo() {
  const [quantities, setQuantities] = useState<DemoValues>({...demoQuantities});
  const [minimums, setMinimums] = useState<DemoValues>({...demoMinimums});
  const [comments, setComments] = useState('');
  const [mode, setMode] = useState('Single'); const [reels, setReels] = useState('3');
  const [custom, setCustom] = useState(false); const [error, setError] = useState('');
  const [report, setReport] = useState<ReturnType<typeof createReport> | null>(null);
  const [ratios, setRatios] = useState<Ratios>(structuredClone(defaultRatios));
  const [auto, setAuto] = useState(true); const [hours, setHours] = useState('6');
  const [pattern, setPattern] = useState(1); const [drawn, setDrawn] = useState<number[]>([]);
  const [refill, setRefill] = useState(false);
  let timing: ReturnType<typeof demoTiming> | null = null;
  try { timing = demoTiming(quantities.Views, pattern, auto ? undefined : hours); } catch { /* inline invalid state */ }
  const invalidate = () => {setReport(null);setError('');};
  const reset = () => {setQuantities({...demoQuantities});setMinimums({...demoMinimums});setComments('');setMode('Single');setReels('3');setCustom(false);setRatios(structuredClone(defaultRatios));setAuto(true);setHours('6');setPattern(1);setDrawn([]);setRefill(false);invalidate();};
  const fill = (views = quantities.Views) => { try { const values=fillRatios(views,ratios);if(comments.trim())values.Comments=String(countComments(comments));setQuantities(values);invalidate(); } catch(e) {setError(e instanceof Error?e.message:'Invalid ratios');} };
  const simulate = () => {
    if(mode === 'Mass' && (!reels.trim() || !Number.isInteger(Number(reels)) || Number(reels)<1 || Number(reels)>100)) {setError('Reel count must be between 1 and 100.');return;}
    if(!timing){setError('Check base views and timeframe (0.5–48 hours).');return;}
    setError('');setReport(createReport(quantities,minimums,String(timing.runs),mode,reels,pattern,timing.hours,drawn,refill));
  };
  const blocked = report?.items.some(item => item.error);
  return <div className="safe-demo">
    <header className="demo-header"><a className="demo-brand" href="https://boostbotting.site"><FlaskConical size={25}/>Boostly<span>PRO</span></a><span className="demo-badge"><ShieldCheck size={15}/> SAFE DEMO</span></header>
    <main className="demo-main">
      <div className="demo-title"><div><div className="demo-eyebrow">TEST WORKSPACE</div><h1>Engagement sandbox</h1><p>Manual quantities. Minimum limits. No live orders.</p></div><Button variant="outline" onClick={reset}><RotateCcw/>Reset</Button></div>
      <div className="demo-safety"><ShieldCheck size={22}/><div><strong>Provider connections are disabled</strong><span>Simulation only · No balance charges · Nothing is sent to Instagram</span></div><span className="demo-offline">ISOLATED</span></div>
      <div className="demo-grid"><section>
        <div className="demo-section-title"><h2>Test setup</h2><div className="demo-segment" role="group" aria-label="Order mode">{['Single','Mass'].map(v=><Button key={v} size="sm" variant={mode===v?'default':'ghost'} aria-pressed={mode===v} onClick={()=>{setMode(v);invalidate();}}>{v}</Button>)}</div></div>
        <div className="demo-setup"><label>Base views quantity<input aria-label="Base views quantity" type="number" min="0" max="1000000" value={quantities.Views} onChange={e=>{const v=e.target.value;setQuantities(old=>({...old,Views:v}));invalidate();try{const values=fillRatios(v,ratios);if(comments.trim())values.Comments=String(countComments(comments));setQuantities(values);}catch(e){setError(e instanceof Error?e.message:'Invalid ratios');}}}/></label>{mode==='Mass'?<label>Number of test reels<input aria-label="Number of test reels" type="number" min="1" max="100" value={reels} onChange={e=>{setReels(e.target.value);invalidate();}}/></label>:<div className="demo-setup-note">01<span>Test reel</span></div>}</div>
        <DemoPlanner views={quantities.Views} ratios={ratios} setRatios={v=>{setRatios(v);invalidate();}} onFill={()=>fill()} auto={auto} setAuto={v=>{setAuto(v);invalidate();}} hours={hours} setHours={v=>{setHours(v);invalidate();}} pattern={pattern} setPattern={v=>{setPattern(v);invalidate();}} timing={timing} drawn={drawn} setDrawn={v=>{setDrawn(v);invalidate();}}/>
        <div className="demo-section-title demo-divider"><h2>Engagement breakdown</h2><span className="demo-small">Quantity per reel</span></div>
        <div className="demo-table-head"><span>Engagement</span><span>Quantity</span><span>Minimum</span></div>
        {engagementTypes.map(type=>{const Icon=icons[type];return <div className="demo-engagement-row" key={type}><label htmlFor={`quantity-${type}`}><Icon size={18}/>{type}</label><input id={`quantity-${type}`} aria-label={`${type} quantity`} type="number" min="0" max="1000000" value={quantities[type]} onChange={e=>{setQuantities(old=>({...old,[type]:e.target.value}));invalidate();}}/><input aria-label={`${type} minimum`} type="number" min="1" max="1000000" disabled={!custom} value={minimums[type]} onChange={e=>{setMinimums(old=>({...old,[type]:e.target.value}));invalidate();}}/></div>;})}
        <div className="demo-minimum-toggle"><label><input type="checkbox" checked={custom} onChange={e=>{setCustom(e.target.checked);if(!e.target.checked)setMinimums({...demoMinimums});invalidate();}}/>Custom minimum limits</label><span className="demo-small">0 quantity = skipped</span></div>
        <label className="demo-comments">Custom comments<textarea aria-label="Custom comments" rows={4} placeholder="One comment per line" value={comments} onChange={e=>{const text=e.target.value;setComments(text);setQuantities(old=>({...old,Comments:String(countComments(text))}));invalidate();}}/><span className="demo-small">{countComments(comments)} comments</span></label>
        <label className="demo-minimum-toggle"><span><input type="checkbox" checked={refill} onChange={e=>{setRefill(e.target.checked);invalidate();}}/> Refill simulation with same curve</span></label>
        {error&&<p role="alert" className="demo-error">{error}</p>}<Button className="demo-run" onClick={simulate}><Play/>Run safe simulation</Button>
      </section><section className="demo-results" aria-live="polite">
        <div className="demo-section-title"><h2>Simulation results</h2><span className="demo-small">LOCAL ONLY</span></div>
        <div className="demo-stats"><div><strong>{report?report.reels:'—'}</strong><span>Test reels</span></div><div><strong>0</strong><span>Real orders sent</span></div></div>
        {!report?<div className="demo-empty"><FlaskConical size={42}/><h3>Ready for a dry run</h3><p>No simulation yet</p></div>:<>
          <p className="demo-small">{report.refill?'Refill dry run':'Initial dry run'} · {drawn.length?'Freehand':patterns[report.pattern%10]} · {report.hours} hours</p>
          {mode==='Mass'&&<div className="demo-reels">{Array.from({length:report.reels},(_,i)=><div key={i}><strong>Test reel {i+1}</strong><span>{drawn.length?'Freehand':patterns[report.pattern%10]} · {report.items[0]?.runs.length ?? 0} views runs</span></div>)}</div>}
          <div className={blocked?'demo-status demo-error':'demo-status'}>{blocked?<Ban size={18}/>:<CheckCircle2 size={18}/>}<strong>{blocked?'Simulation blocked — review limits':'Minimum limits passed'}</strong></div>
          {report.items.map(item=><div className="demo-result-row" key={item.type}><div className="demo-result-heading"><strong>{item.type}</strong><span>{item.error?'Blocked':!item.runs.length?'Skipped':`${item.runs.length} simulated runs / reel`}</span></div>{item.error?<p className="demo-error">{item.error}</p>:<><div className="demo-run-values">{item.runs.map((value,index)=><span key={index} title={`Simulated run ${index+1}`}>{value.toLocaleString()}</span>)}</div>{item.runs.length>0&&<div className="demo-small">Total / reel: {report.quantities[item.type]} · Minimum: {report.minimums[item.type]} · All reels: {(Number(report.quantities[item.type])*report.reels).toLocaleString()}</div>}</>}</div>)}
          <p className="demo-small demo-result-foot">Smaller batches are combined to respect each minimum. Blocked simulations cannot be submitted.</p>
        </>}
      </section></div>
      <footer className="demo-footer"><ShieldCheck size={14}/> Safe demo · Provider API unavailable <a href="https://boostbotting.site">Back to Boostly ↗</a></footer>
    </main>
  </div>;
}
