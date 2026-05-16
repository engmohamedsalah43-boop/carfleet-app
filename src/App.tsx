import { 
  collection, 
  addDoc, 
  getDocs,
  deleteDoc,
  doc
} from "firebase/firestore";
import { db } from "./firebase";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const LS = {
  get: (k: string, d: any) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },

  set: (k: string, v: any) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG");
const daysBetween = (d: any) => {
  if (!d) return null;
  return Math.ceil(
    (new Date(d).getTime() - new Date().getTime()) / 86400000
  );
};
const todayStr = () => new Date().toISOString().split("T")[0];

function kmStatus(lastKm: any, interval: any, cur: any) {
  if (!lastKm || !cur) return "ok";
  const r = +lastKm + +interval - +cur;
  return r < 0 ? "danger" : r < 500 ? "warning" : "ok";
}
function dateStatus(exp: any, warn = 30) {
  const d = daysBetween(exp);
  if (d === null) return "ok";
  return d < 0 ? "danger" : d <= warn ? "warning" : "ok";
}

const S = {
  ok:      { bg:"rgba(52,211,153,.12)",  border:"rgba(52,211,153,.3)",  text:"#34d399", label:"✅ جيد" },
  warning: { bg:"rgba(251,191,36,.12)",  border:"rgba(251,191,36,.3)",  text:"#fbbf24", label:"⚠️ قريباً" },
  danger:  { bg:"rgba(239,68,68,.14)",   border:"rgba(239,68,68,.35)",  text:"#f87171", label:"🚨 متأخر" },
};

const MAINT_DEFAULTS = [
  { id:1, name:"فلتر الهواء",         intervalKm:15000 },
  { id:2, name:"فلتر الوقود",         intervalKm:30000 },
  { id:3, name:"سائل الفرامل",        intervalKm:40000 },
  { id:4, name:"سائل التبريد",        intervalKm:50000 },
  { id:5, name:"بواجي الإشعال",       intervalKm:30000 },
  { id:6, name:"سير التوقيت",         intervalKm:60000 },
  { id:7, name:"زيت ناقل الحركة",     intervalKm:40000 },
  { id:8, name:"فحص الفرامل",         intervalKm:20000 },
];

function newCar(id) {
  return {
    id, name:"", brand:"", model:"", year:"", plate:"", color:"", fuelType:"بنزين",
    currentKm:0, photo:"",
    driver:{ name:"", phone:"", licenseNo:"", licenseExpiry:"" },
    oil:{ lastDate:"", lastKm:"", intervalKm:5000, cost:"", notes:"", brand:"" },
    tires:{ lastDate:"", lastKm:"", intervalKm:40000, brand:"", condition:"جيد", cost:"", notes:"" },
    license:{ expiryDate:"", cost:"", notes:"" },
    insurance:{ expiryDate:"", company:"", cost:"", notes:"" },
    maintenances: MAINT_DEFAULTS.map(m=>({...m, lastKm:"", lastDate:"", cost:"", notes:""})),
    fuelLogs:[], parts:[], history:[],
  };
}

function buildAlerts(cars) {
  const alerts = [];
  for (const c of cars) {
    const n = c.name || c.brand || "سيارة";
    const push = (type, icon, title, status, detail) => alerts.push({ carId:c.id, carName:n, plate:c.plate, type, icon, title, status, detail });
    const os = kmStatus(c.oil.lastKm, c.oil.intervalKm, c.currentKm);
    if (os !== "ok") { const r = +c.oil.lastKm + +c.oil.intervalKm - +c.currentKm; push("oil","🛢️","تغيير الزيت",os, r<0?`متأخر ${Math.abs(r).toLocaleString()} كم`:`بعد ${r.toLocaleString()} كم`); }
    const ts = kmStatus(c.tires.lastKm, c.tires.intervalKm, c.currentKm);
    if (ts !== "ok") { const r = +c.tires.lastKm + +c.tires.intervalKm - +c.currentKm; push("tires","🔧","تغيير الكاوتش",ts, r<0?`متأخر ${Math.abs(r).toLocaleString()} كم`:`بعد ${r.toLocaleString()} كم`); }
    const ls = dateStatus(c.license.expiryDate, 30);
    if (ls !== "ok") { const d = daysBetween(c.license.expiryDate); push("license","📋","ترخيص السيارة",ls, d<0?`منتهي منذ ${Math.abs(d)} يوم`:`ينتهي بعد ${d} يوم`); }
    const ins = dateStatus(c.insurance.expiryDate, 30);
    if (ins !== "ok") { const d = daysBetween(c.insurance.expiryDate); push("insurance","🛡️","التأمين",ins, d<0?`منتهي منذ ${Math.abs(d)} يوم`:`ينتهي بعد ${d} يوم`); }
    const dl = dateStatus(c.driver?.licenseExpiry, 30);
    if (dl !== "ok") { const d = daysBetween(c.driver?.licenseExpiry); push("driver","👤","رخصة السائق",dl, d<0?`منتهية منذ ${Math.abs(d)} يوم`:`تنتهي بعد ${d} يوم`); }
    for (const m of c.maintenances) {
      const ms = kmStatus(m.lastKm, m.intervalKm, c.currentKm);
      if (ms !== "ok") { const r = +m.lastKm + +m.intervalKm - +c.currentKm; push("maint","⚙️",m.name,ms, r<0?`متأخر ${Math.abs(r).toLocaleString()} كم`:`بعد ${r.toLocaleString()} كم`); }
    }
  }
  return alerts.sort((a,b) => a.status==="danger"?-1:b.status==="danger"?1:0);
}

const Badge = ({status}) => { const s=S[status]||S.ok; return <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:s.bg,border:`1px solid ${s.border}`,color:s.text,fontWeight:700,whiteSpace:"nowrap"}}>{s.label}</span>; };
const Inp = ({value,onChange,type="text",placeholder=""}) =>
  <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}
    style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.13)",color:"white",borderRadius:10,padding:"9px 13px",width:"100%",fontFamily:"'Cairo',sans-serif",fontSize:13,outline:"none"}} />;
const Sel = ({value,onChange,options}) =>
  <select value={value} onChange={e=>onChange(e.target.value)}
    style={{background:"#1a1f35",border:"1px solid rgba(255,255,255,0.13)",color:"white",borderRadius:10,padding:"9px 13px",width:"100%",fontFamily:"'Cairo',sans-serif",fontSize:13,outline:"none"}}>
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>;
const Btn = ({onClick,children,color="#3b82f6",style={}}) =>
  <button onClick={onClick} style={{padding:"10px 20px",borderRadius:11,border:"none",cursor:"pointer",background:color,color:"white",fontFamily:"'Cairo',sans-serif",fontWeight:700,fontSize:13,...style}}>{children}</button>;
const Field = ({label,children,span=1}) =>
  <div style={{display:"flex",flexDirection:"column",gap:5,gridColumn:`span ${span}`}}>
    <label style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontWeight:600}}>{label}</label>{children}
  </div>;
const Panel = ({children,style={}}) =>
  <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:18,padding:20,...style}}>{children}</div>;
const SHead = ({ icon, title, sub = "" }) => (
  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
    <span style={{fontSize:22}}>{icon}</span>

    <div>
      <div style={{color:"white",fontWeight:900,fontSize:16}}>
        {title}
      </div>

      {sub && (
        <div style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>
          {sub}
        </div>
      )}
    </div>
  </div>
);

// ── AI Assistant ──
function AIAssistant({ car }) {
  const [messages, setMessages] = useState([{role:"assistant",text:"مرحباً! أنا مساعدك الذكي لصيانة السيارات. اسألني عن أي شيء 🚗"}]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);
  const send = async (msg = input) => {
    const userMsg = (msg || input).trim();
    if (!userMsg || loading) return;
    setInput("");
    setMessages(p => [...p, {role:"user",text:userMsg}]);
    setLoading(true);
    const carCtx = car ? `السيارة: ${car.brand} ${car.model} ${car.year}, العداد: ${car.currentKm} كم, الوقود: ${car.fuelType}` : "";
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          system:`أنت خبير صيانة سيارات مصري محترف. أجب بالعربية بشكل مفيد ومختصر. ${carCtx}`,
          messages:[...messages.filter((_,i)=>i>0).map(m=>({role:m.role==="assistant"?"assistant":"user",content:m.text})),{role:"user",content:userMsg}]
        })
      });
      const data = await res.json();
      setMessages(p => [...p, {role:"assistant",text:data.content?.[0]?.text||"عذراً حدث خطأ"}]);
    } catch { setMessages(p => [...p, {role:"assistant",text:"تعذر الاتصال"}]); }
    setLoading(false);
  };
  const suggestions = ["أفضل زيت لسيارتي؟","متى أغير الفلاتر؟","أسباب ارتفاع استهلاك الوقود","كيف أفحص الفرامل؟"];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <SHead icon="🤖" title="المساعد الذكي" sub="اسأل عن الصيانة والأعطال والقطع" />
      <div style={{background:"rgba(0,0,0,0.3)",borderRadius:14,padding:16,minHeight:280,maxHeight:380,overflowY:"auto",display:"flex",flexDirection:"column",gap:10}}>
        {messages.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"85%",padding:"10px 14px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:m.role==="user"?"linear-gradient(135deg,#f97316,#ef4444)":"rgba(255,255,255,0.09)",color:"white",fontSize:14,lineHeight:1.6}}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && <div style={{display:"flex",gap:5,padding:"10px 14px",background:"rgba(255,255,255,0.09)",borderRadius:"16px 16px 16px 4px",width:"fit-content"}}>
          {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"rgba(255,255,255,0.5)",animation:`bounce 1s ${i*0.2}s infinite`}} />)}
        </div>}
        <div ref={endRef} />
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {suggestions.map(q=><button key={q} onClick={()=>send(q)} style={{padding:"6px 12px",borderRadius:20,border:"1px solid rgba(249,115,22,0.3)",background:"rgba(249,115,22,0.08)",color:"rgba(255,255,255,0.6)",fontFamily:"'Cairo',sans-serif",fontSize:12,cursor:"pointer"}}>{q}</button>)}
      </div>
      <div style={{display:"flex",gap:10}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="اكتب سؤالك هنا..."
          style={{flex:1,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",color:"white",borderRadius:12,padding:"11px 14px",fontFamily:"'Cairo',sans-serif",fontSize:13,outline:"none"}} />
        <button onClick={()=>send()} disabled={loading} style={{padding:"11px 20px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#f97316,#ef4444)",color:"white",fontFamily:"'Cairo',sans-serif",fontWeight:700,opacity:loading?0.6:1}}>إرسال</button>
      </div>
    </div>
  );
}

// ── Analytics ──
function Analytics({ cars }) {
  const totalCost = c => (c.parts||[]).reduce((s,p)=>s+ +(p.cost||0),0)+ +(c.oil.cost||0)+ +(c.tires.cost||0)+c.maintenances.reduce((s,m)=>s+ +(m.cost||0),0)+(c.fuelLogs||[]).reduce((s,l)=>s+ +(l.cost||0),0)+ +(c.insurance.cost||0)+ +(c.license.cost||0);
  const costPerKm = c => { const cost=totalCost(c); return (c.currentKm&&cost)?(cost/c.currentKm).toFixed(2):0; };
  const avgFuel = c => { const logs=[...(c.fuelLogs||[])].sort((a,b)=>+a.km-+b.km); if(logs.length<2)return null; const liters=logs.slice(1).reduce((s,l)=>s+ +(l.liters||0),0); const km=+logs[logs.length-1].km-+logs[0].km; return km>0?(liters/km*100).toFixed(1):null; };
  const sorted = [...cars].sort((a,b)=>totalCost(b)-totalCost(a));
  const grandTotal = cars.reduce((s,c)=>s+totalCost(c),0);
  const monthlyFuel = useMemo(()=>{ const m={}; for(const c of cars) for(const l of(c.fuelLogs||[])) { if(!l.date)continue; const k=l.date.slice(0,7); m[k]=(m[k]||0)+ +(l.cost||0); } return Object.entries(m).sort().slice(-6); },[cars]);
  const maxMV = Math.max(
  ...monthlyFuel.map((m: any) => Number(m[1] || 0)),
  1
);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
        {[
          {icon:"💰",label:"إجمالي مصاريف الأسطول",value:`${fmt(grandTotal)} جنيه`,color:"#f97316"},
          {icon:"🚗",label:"عدد السيارات",value:cars.length,color:"#3b82f6"},
          {icon:"📏",label:"أعلى تكلفة/كم",value:(()=>{const r=[...cars].sort((a,b)=>Number(costPerKm(b)) - Number(costPerKm(a)))[0];return r?`${r.name||r.brand}: ${costPerKm(r)} ج/كم`:"—"})(),color:"#10b981"},
        ].map(s=><Panel key={s.label} style={{border:`1px solid ${s.color}25`}}><div style={{fontSize:26}}>{s.icon}</div><div style={{color:"white",fontSize:20,fontWeight:900,marginTop:8}}>{s.value}</div><div style={{color:"rgba(255,255,255,0.4)",fontSize:12,marginTop:4}}>{s.label}</div></Panel>)}
      </div>
      <Panel>
        <SHead icon="📊" title="مقارنة تكاليف السيارات" />
        {sorted.slice(0,8).map(c=>{ const cost=totalCost(c); const pct=grandTotal?(cost/grandTotal*100).toFixed(1):0;
          return <div key={c.id} style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{color:"rgba(255,255,255,0.7)",fontSize:13,fontWeight:700}}>{c.name||c.brand||"سيارة"} {c.plate?`(${c.plate})`:""}</span><span style={{color:"#f97316",fontWeight:900}}>{fmt(cost)} جنيه</span></div>
            <div style={{background:"rgba(255,255,255,0.07)",borderRadius:20,height:10,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#f97316,#ef4444)",borderRadius:20}} /></div>
            <div style={{color:"rgba(255,255,255,0.3)",fontSize:11,marginTop:3}}>{pct}% من الإجمالي</div>
          </div>;
        })}
      </Panel>
      {monthlyFuel.length>0 && <Panel>
        <SHead icon="⛽" title="مصاريف الوقود الشهرية" sub="آخر 6 شهور" />
        <div style={{display:"flex",gap:10,alignItems:"flex-end",height:130}}>
          {monthlyFuel.map(([month,val])=>(
            <div key={month} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{color:"rgba(255,255,255,0.5)",fontSize:10}}>{fmt(val)}</div>
              <div style={{width:"100%",background:"linear-gradient(180deg,#10b981,#059669)",borderRadius:"6px 6px 0 0",height:`(Number(val) / Number(maxMV)) * 100}px`,minHeight:4,transition:"height 0.6s"}} />
              <div style={{color:"rgba(255,255,255,0.3)",fontSize:10}}>{month.slice(5)}</div>
            </div>
          ))}
        </div>
      </Panel>}
      <Panel>
        <SHead icon="📏" title="تكلفة الكيلومتر لكل سيارة" />
        {[...cars].sort((a:any,b:any)=>Number(costPerKm(b)) - Number(costPerKm(a))).map((c:any)=>(
          <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderRadius:12,background:"rgba(255,255,255,0.04)",marginBottom:6}}>
            <div><div style={{color:"rgba(255,255,255,0.7)",fontSize:13,fontWeight:700}}>{c.name||c.brand||"سيارة"}</div><div style={{color:"rgba(255,255,255,0.3)",fontSize:11}}>{fmt(c.currentKm)} كم · {avgFuel(c)?`${avgFuel(c)} ل/100كم`:"—"}</div></div>
            <span style={{color:Number(costPerKm(c))>2?"#f87171":Number(costPerKm(c))>1?"#fbbf24":"#34d399",fontWeight:900,fontSize:15}}>
  {costPerKm(c)} جنيه/كم
</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ── History ──
function HistoryLog({ car, onUpdate }) {
  const [form, setForm] = useState({date:todayStr(),type:"صيانة",desc:"",cost:"",km:""});
  const history = [...(car.history||[])].sort((a,b)=>new Date(b.date).getTime() - new Date(a.date).getTime());
  const typeIcon = t => t.includes("زيت")?"🛢️":t.includes("كاوتش")?"🔧":t.includes("وقود")?"⛽":t.includes("قطعة")?"🔩":"📝";
  return (
    <div>
      <Panel style={{marginBottom:16}}>
        <SHead icon="📝" title="إضافة سجل" />
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <Field label="التاريخ"><Inp type="date" value={form.date} onChange={v=>setForm(p=>({...p,date:v}))} /></Field>
          <Field label="النوع"><Sel value={form.type} onChange={v=>setForm(p=>({...p,type:v}))} options={["تغيير زيت","تغيير كاوتش","صيانة","قطعة غيار","وقود","ترخيص","تأمين","أخرى"]} /></Field>
          <Field label="الوصف" span={2}><Inp value={form.desc} onChange={v=>setForm(p=>({...p,desc:v}))} placeholder="وصف ما تم..." /></Field>
          <Field label="التكلفة (جنيه)"><Inp type="number" value={form.cost} onChange={v=>setForm(p=>({...p,cost:v}))} /></Field>
          <Field label="الكيلومتر"><Inp type="number" value={form.km} onChange={v=>setForm(p=>({...p,km:v}))} /></Field>
        </div>
        <Btn onClick={()=>{ if(!form.desc)return; onUpdate({...car,history:[...(car.history||[]),{...form,id:Date.now()}]}); setForm({date:todayStr(),type:"صيانة",desc:"",cost:"",km:""}); }} color="#10b981" style={{width:"100%"}}>+ إضافة للسجل</Btn>
      </Panel>
      {history.map(h=>(
        <div key={h.id} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"12px 16px",borderRadius:14,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",marginBottom:8}}>
          <div style={{background:"rgba(249,115,22,0.12)",borderRadius:10,padding:"8px",fontSize:18,border:"1px solid rgba(249,115,22,0.2)",flexShrink:0}}>{typeIcon(h.type)}</div>
          <div style={{flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><span style={{color:"white",fontWeight:700,fontSize:14}}>{h.desc}</span> <span style={{marginRight:6,padding:"2px 8px",borderRadius:20,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.4)",fontSize:11}}>{h.type}</span></div>
              <button onClick={()=>onUpdate({...car,history:car.history.filter(x=>x.id!==h.id)})} style={{color:"rgba(239,68,68,0.5)",background:"none",border:"none",cursor:"pointer",fontSize:15}}>✕</button>
            </div>
            <div style={{color:"rgba(255,255,255,0.35)",fontSize:12,marginTop:4,display:"flex",gap:12,flexWrap:"wrap"}}>
              <span>📅 {h.date}</span>
              {h.km&&<span>📍 {fmt(h.km)} كم</span>}
              {h.cost&&<span style={{color:"#34d399"}}>💰 {fmt(h.cost)} جنيه</span>}
            </div>
          </div>
        </div>
      ))}
      {history.length===0&&<div style={{textAlign:"center",padding:40,color:"rgba(255,255,255,0.2)"}}>لا يوجد سجل بعد</div>}
    </div>
  );
}

// ── Car Detail ──
function CarDetail({ car, onUpdate, onBack, onDelete }) {
  const [tab, setTab] = useState("info");
  const upd = p => onUpdate({...car,...p});
  const [newFuel, setNewFuel] = useState({date:todayStr(),km:"",liters:"",cost:"",station:""});
  const [newPart, setNewPart] = useState({name:"",cost:"",date:todayStr(),notes:"",qty:"1"});
  const [newMaintName, setNewMaintName] = useState("");

  const oilRem = car.oil.lastKm ? +car.oil.lastKm + +car.oil.intervalKm - +car.currentKm : null;
  const tireRem = car.tires.lastKm ? +car.tires.lastKm + +car.tires.intervalKm - +car.currentKm : null;
  const avgFuel = () => { const logs=[...(car.fuelLogs||[])].sort((a,b)=>+a.km-+b.km); if(logs.length<2)return null; const liters=logs.slice(1).reduce((s,l)=>s+ +(l.liters||0),0); const km=+logs[logs.length-1].km-+logs[0].km; return km>0?(liters/km*100).toFixed(1):null; };
  const totalFuelCost = (car.fuelLogs||[]).reduce((s,l)=>s+ +(l.cost||0),0);
  const totalPartsCost = (car.parts||[]).reduce((s,p)=>s+ +(p.cost||0),0);

  const TABS = [{id:"info",icon:"🚗",label:"البيانات"},{id:"oil",icon:"🛢️",label:"الزيت"},{id:"tires",icon:"🔧",label:"الكاوتش"},{id:"license",icon:"📋",label:"الترخيص"},{id:"driver",icon:"👤",label:"السائق"},{id:"maintenance",icon:"⚙️",label:"الصيانة"},{id:"fuel",icon:"⛽",label:"الوقود"},{id:"parts",icon:"🔩",label:"قطع الغيار"},{id:"history",icon:"📝",label:"السجل"},{id:"ai",icon:"🤖",label:"مساعد ذكي"}];

  const statItems = [
    {l:"زيت",v:oilRem!==null?`${oilRem.toLocaleString()} كم`:"—",c:oilRem!==null?(oilRem<0?"#f87171":oilRem<500?"#fbbf24":"#34d399"):"white"},
    {l:"كاوتش",v:tireRem!==null?`${tireRem.toLocaleString()} كم`:"—",c:tireRem!==null?(tireRem<0?"#f87171":tireRem<500?"#fbbf24":"#34d399"):"white"},
    {l:"ترخيص",v:car.license.expiryDate?`${daysBetween(car.license.expiryDate)} يوم`:"—",c:dateStatus(car.license.expiryDate)==="danger"?"#f87171":dateStatus(car.license.expiryDate)==="warning"?"#fbbf24":"#34d399"},
    {l:"وقود",v:avgFuel()?`${avgFuel()} ل/100`:"—",c:"#c4b5fd"},
  ];

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"white",borderRadius:10,padding:"8px 16px",cursor:"pointer",fontFamily:"'Cairo',sans-serif",fontWeight:700,fontSize:13}}>← رجوع</button>
        {car.photo&&<img src={car.photo} alt="" style={{width:48,height:48,borderRadius:12,objectFit:"cover",border:"2px solid rgba(249,115,22,0.4)"}} />}
        <div style={{flex:1}}><div style={{color:"white",fontWeight:900,fontSize:22}}>{car.name||car.brand||"سيارة"}</div><div style={{color:"rgba(255,255,255,0.35)",fontSize:13}}>{car.brand} {car.model} {car.year} {car.plate?`· لوحة: ${car.plate}`:""}</div></div>
        <button onClick={onDelete} style={{padding:"8px 16px",borderRadius:10,border:"1px solid rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.08)",color:"#f87171",fontFamily:"'Cairo',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer"}}>🗑️ حذف</button>
      </div>

      <Panel style={{marginBottom:18}}>
        <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:160}}>
            <label style={{color:"rgba(255,255,255,0.4)",fontSize:12,fontWeight:600}}>عداد الكيلومتر</label>
            <input type="number" value={car.currentKm} onChange={e=>upd({currentKm:+e.target.value||0})}
              style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(249,115,22,0.3)",color:"white",borderRadius:12,padding:"10px 14px",fontFamily:"'Cairo',sans-serif",fontSize:20,fontWeight:900,outline:"none",textAlign:"center",marginTop:5}} />
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {statItems.map(item=>(
              <div key={item.l} style={{textAlign:"center",minWidth:80,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:11}}>{item.l}</div>
                <div style={{color:item.c,fontWeight:900,fontSize:14,marginTop:3}}>{item.v}</div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div style={{display:"flex",gap:5,overflowX:"auto",marginBottom:18,paddingBottom:4}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 13px",borderRadius:10,border:"none",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"'Cairo',sans-serif",fontWeight:700,fontSize:12,background:tab===t.id?"linear-gradient(135deg,#f97316,#ef4444)":"rgba(255,255,255,0.06)",color:tab===t.id?"white":"rgba(255,255,255,0.45)"}}>{t.icon} {t.label}</button>)}
      </div>

      {tab==="info"&&<Panel>
        <SHead icon="🚗" title="بيانات السيارة" />
        <div style={{marginBottom:16,display:"flex",gap:14,alignItems:"center"}}>
          <div style={{width:72,height:72,borderRadius:14,background:"rgba(255,255,255,0.06)",border:"2px dashed rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}>
            {car.photo?<img src={car.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:<span style={{fontSize:26}}>📷</span>}
          </div>
          <div>
            <div style={{color:"rgba(255,255,255,0.4)",fontSize:12,marginBottom:8}}>صورة السيارة</div>
            <label style={{padding:"7px 14px",borderRadius:10,border:"1px solid rgba(255,255,255,0.18)",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:12,fontFamily:"'Cairo',sans-serif"}}>📤 رفع صورة
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>upd({photo:ev.target.result});r.readAsDataURL(f);}} />
            </label>
            {car.photo&&<button onClick={()=>upd({photo:""})} style={{marginRight:8,padding:"7px 12px",borderRadius:10,border:"1px solid rgba(239,68,68,0.3)",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:12,fontFamily:"'Cairo',sans-serif"}}>حذف</button>}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Field label="الاسم"><Inp value={car.name} onChange={v=>upd({name:v})} placeholder="سيارة الشركة" /></Field>
          <Field label="الماركة"><Inp value={car.brand} onChange={v=>upd({brand:v})} placeholder="تويوتا" /></Field>
          <Field label="الموديل"><Inp value={car.model} onChange={v=>upd({model:v})} placeholder="كامري" /></Field>
          <Field label="سنة الصنع"><Inp value={car.year} onChange={v=>upd({year:v})} placeholder="2020" /></Field>
          <Field label="رقم اللوحة"><Inp value={car.plate} onChange={v=>upd({plate:v})} placeholder="أ ب ج 1234" /></Field>
          <Field label="اللون"><Inp value={car.color} onChange={v=>upd({color:v})} placeholder="أبيض" /></Field>
          <Field label="نوع الوقود"><Sel value={car.fuelType} onChange={v=>upd({fuelType:v})} options={["بنزين","ديزل","كهرباء","هجين"]} /></Field>
        </div>
      </Panel>}

      {tab==="oil"&&<Panel>
        <SHead icon="🛢️" title="تغيير الزيت" />
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Field label="تاريخ آخر تغيير"><Inp type="date" value={car.oil.lastDate} onChange={v=>upd({oil:{...car.oil,lastDate:v}})} /></Field>
          <Field label="كيلومتر آخر تغيير"><Inp type="number" value={car.oil.lastKm} onChange={v=>upd({oil:{...car.oil,lastKm:v}})} placeholder="45000" /></Field>
          <Field label="الفترة (كم)"><Inp type="number" value={car.oil.intervalKm} onChange={v=>upd({oil:{...car.oil,intervalKm:v}})} placeholder="5000" /></Field>
          <Field label="التكلفة (جنيه)"><Inp type="number" value={car.oil.cost} onChange={v=>upd({oil:{...car.oil,cost:v}})} /></Field>
          <Field label="ماركة الزيت"><Inp value={car.oil.brand} onChange={v=>upd({oil:{...car.oil,brand:v}})} placeholder="Castrol, Mobil..." /></Field>
          <Field label="ملاحظات"><Inp value={car.oil.notes} onChange={v=>upd({oil:{...car.oil,notes:v}})} /></Field>
        </div>
        {oilRem!==null&&<div style={{marginTop:16,padding:16,borderRadius:14,background:S[kmStatus(car.oil.lastKm,car.oil.intervalKm,car.currentKm)].bg,border:`1px solid ${S[kmStatus(car.oil.lastKm,car.oil.intervalKm,car.currentKm)].border}`}}>
          <div style={{color:"rgba(255,255,255,0.45)",fontSize:12}}>التغيير القادم عند</div>
          <div style={{color:"white",fontSize:26,fontWeight:900}}>{(+car.oil.lastKm + +car.oil.intervalKm).toLocaleString()} كم</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}><span style={{color:"rgba(255,255,255,0.45)",fontSize:13}}>المتبقي: {oilRem.toLocaleString()} كم</span><Badge status={kmStatus(car.oil.lastKm,car.oil.intervalKm,car.currentKm)} /></div>
        </div>}
      </Panel>}

      {tab==="tires"&&<Panel>
        <SHead icon="🔧" title="الكاوتش" />
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Field label="تاريخ آخر تغيير"><Inp type="date" value={car.tires.lastDate} onChange={v=>upd({tires:{...car.tires,lastDate:v}})} /></Field>
          <Field label="كيلومتر آخر تغيير"><Inp type="number" value={car.tires.lastKm} onChange={v=>upd({tires:{...car.tires,lastKm:v}})} /></Field>
          <Field label="الفترة (كم)"><Inp type="number" value={car.tires.intervalKm} onChange={v=>upd({tires:{...car.tires,intervalKm:v}})} placeholder="40000" /></Field>
          <Field label="التكلفة (جنيه)"><Inp type="number" value={car.tires.cost} onChange={v=>upd({tires:{...car.tires,cost:v}})} /></Field>
          <Field label="ماركة الإطار"><Inp value={car.tires.brand} onChange={v=>upd({tires:{...car.tires,brand:v}})} placeholder="ميشلان، بريدجستون" /></Field>
          <Field label="الحالة"><Sel value={car.tires.condition} onChange={v=>upd({tires:{...car.tires,condition:v}})} options={["جيد","مقبول","يحتاج تغيير"]} /></Field>
        </div>
      </Panel>}

      {tab==="license"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
        <Panel>
          <SHead icon="📋" title="ترخيص السيارة" />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="تاريخ الانتهاء"><Inp type="date" value={car.license.expiryDate} onChange={v=>upd({license:{...car.license,expiryDate:v}})} /></Field>
            <Field label="التكلفة (جنيه)"><Inp type="number" value={car.license.cost} onChange={v=>upd({license:{...car.license,cost:v}})} /></Field>
            <Field label="ملاحظات" span={2}><Inp value={car.license.notes} onChange={v=>upd({license:{...car.license,notes:v}})} /></Field>
          </div>
          {car.license.expiryDate&&(()=>{const d=daysBetween(car.license.expiryDate);const s=dateStatus(car.license.expiryDate);return <div style={{marginTop:12,padding:14,borderRadius:12,background:S[s].bg,border:`1px solid ${S[s].border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{color:"white",fontWeight:700}}>{d<0?`منتهي منذ ${Math.abs(d)} يوم`:`ينتهي بعد ${d} يوم`}</span><Badge status={s} /></div>;})()}
        </Panel>
        <Panel>
          <SHead icon="🛡️" title="التأمين" />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="تاريخ الانتهاء"><Inp type="date" value={car.insurance.expiryDate} onChange={v=>upd({insurance:{...car.insurance,expiryDate:v}})} /></Field>
            <Field label="شركة التأمين"><Inp value={car.insurance.company} onChange={v=>upd({insurance:{...car.insurance,company:v}})} /></Field>
            <Field label="التكلفة (جنيه)"><Inp type="number" value={car.insurance.cost} onChange={v=>upd({insurance:{...car.insurance,cost:v}})} /></Field>
            <Field label="ملاحظات"><Inp value={car.insurance.notes} onChange={v=>upd({insurance:{...car.insurance,notes:v}})} /></Field>
          </div>
          {car.insurance.expiryDate&&(()=>{const d=daysBetween(car.insurance.expiryDate);const s=dateStatus(car.insurance.expiryDate);return <div style={{marginTop:12,padding:14,borderRadius:12,background:S[s].bg,border:`1px solid ${S[s].border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{color:"white",fontWeight:700}}>{d<0?`منتهي منذ ${Math.abs(d)} يوم`:`ينتهي بعد ${d} يوم`}</span><Badge status={s} /></div>;})()}
        </Panel>
      </div>}

      {tab==="driver"&&<Panel>
        <SHead icon="👤" title="بيانات السائق" />
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Field label="اسم السائق"><Inp value={car.driver?.name||""} onChange={v=>upd({driver:{...car.driver,name:v}})} /></Field>
          <Field label="رقم الهاتف"><Inp value={car.driver?.phone||""} onChange={v=>upd({driver:{...car.driver,phone:v}})} placeholder="01xxxxxxxxx" /></Field>
          <Field label="رقم الرخصة"><Inp value={car.driver?.licenseNo||""} onChange={v=>upd({driver:{...car.driver,licenseNo:v}})} /></Field>
          <Field label="انتهاء رخصة القيادة"><Inp type="date" value={car.driver?.licenseExpiry||""} onChange={v=>upd({driver:{...car.driver,licenseExpiry:v}})} /></Field>
        </div>
        {car.driver?.licenseExpiry&&(()=>{const d=daysBetween(car.driver.licenseExpiry);const s=dateStatus(car.driver.licenseExpiry);return <div style={{marginTop:12,padding:14,borderRadius:12,background:S[s].bg,border:`1px solid ${S[s].border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{color:"white",fontWeight:700}}>{d<0?`رخصة منتهية منذ ${Math.abs(d)} يوم`:`رخصة تنتهي بعد ${d} يوم`}</span><Badge status={s} /></div>;})()}
      </Panel>}

      {tab==="maintenance"&&<div>
        {car.maintenances.map(m=>{
          const s=kmStatus(m.lastKm,m.intervalKm,car.currentKm);
          const rem=m.lastKm?+m.lastKm+ +m.intervalKm- +car.currentKm:null;
          return <Panel key={m.id} style={{marginBottom:12,borderColor:S[s].border,background:S[s].bg}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <span style={{color:"white",fontWeight:900}}>⚙️ {m.name}</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {rem!==null&&<span style={{fontSize:12,color:"rgba(255,255,255,0.45)"}}>{rem.toLocaleString()} كم</span>}
                <Badge status={s} />
                <button onClick={()=>upd({maintenances:car.maintenances.filter(x=>x.id!==m.id)})} style={{color:"rgba(239,68,68,0.5)",background:"none",border:"none",cursor:"pointer",fontSize:15}}>✕</button>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
              <Field label="آخر تاريخ"><Inp type="date" value={m.lastDate} onChange={v=>upd({maintenances:car.maintenances.map(x=>x.id===m.id?{...x,lastDate:v}:x)})} /></Field>
              <Field label="آخر كيلومتر"><Inp type="number" value={m.lastKm} onChange={v=>upd({maintenances:car.maintenances.map(x=>x.id===m.id?{...x,lastKm:v}:x)})} /></Field>
              <Field label="الفترة (كم)"><Inp type="number" value={m.intervalKm} onChange={v=>upd({maintenances:car.maintenances.map(x=>x.id===m.id?{...x,intervalKm:v}:x)})} /></Field>
              <Field label="التكلفة (جنيه)"><Inp type="number" value={m.cost} onChange={v=>upd({maintenances:car.maintenances.map(x=>x.id===m.id?{...x,cost:v}:x)})} /></Field>
            </div>
          </Panel>;
        })}
        <Panel><div style={{display:"flex",gap:10}}><Inp value={newMaintName} onChange={setNewMaintName} placeholder="صيانة جديدة..." /><Btn onClick={()=>{if(!newMaintName.trim())return;upd({maintenances:[...car.maintenances,{id:Date.now(),name:newMaintName,intervalKm:10000,lastKm:"",cost:"",lastDate:""}]});setNewMaintName("");}} color="#10b981">+ إضافة</Btn></div></Panel>
      </div>}

      {tab==="fuel"&&<div>
        <Panel style={{marginBottom:16}}>
          <SHead icon="⛽" title="تسجيل تعبئة وقود" />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <Field label="التاريخ"><Inp type="date" value={newFuel.date} onChange={v=>setNewFuel(p=>({...p,date:v}))} /></Field>
            <Field label="الكيلومتر"><Inp type="number" value={newFuel.km} onChange={v=>setNewFuel(p=>({...p,km:v}))} /></Field>
            <Field label="الكمية (لتر)"><Inp type="number" value={newFuel.liters} onChange={v=>setNewFuel(p=>({...p,liters:v}))} /></Field>
            <Field label="التكلفة (جنيه)"><Inp type="number" value={newFuel.cost} onChange={v=>setNewFuel(p=>({...p,cost:v}))} /></Field>
            <Field label="المحطة" span={2}><Inp value={newFuel.station} onChange={v=>setNewFuel(p=>({...p,station:v}))} placeholder="اسم محطة الوقود" /></Field>
          </div>
          <Btn onClick={()=>{if(!newFuel.liters)return;upd({fuelLogs:[...(car.fuelLogs||[]),{...newFuel,id:Date.now()}]});setNewFuel({date:todayStr(),km:"",liters:"",cost:"",station:""});}} color="#10b981" style={{width:"100%"}}>+ تسجيل التعبئة</Btn>
        </Panel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
          {[{l:"إجمالي مصاريف الوقود",v:`${fmt(totalFuelCost)} جنيه`,c:"#34d399"},{l:"متوسط الاستهلاك",v:avgFuel()?`${avgFuel()} ل/100كم`:"—",c:"#c4b5fd"},{l:"عدد التعبئات",v:`${(car.fuelLogs||[]).length} مرة`,c:"#fbbf24"}].map(s=>(
            <div key={s.l} style={{padding:14,borderRadius:14,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",textAlign:"center"}}>
              <div style={{color:s.c,fontSize:18,fontWeight:900}}>{s.v}</div>
              <div style={{color:"rgba(255,255,255,0.35)",fontSize:11,marginTop:4}}>{s.l}</div>
            </div>
          ))}
        </div>
        {(car.fuelLogs||[]).slice().reverse().map(l=>(
          <Panel key={l.id} style={{marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:"white",fontWeight:700}}>⛽ {l.liters} لتر {l.station?`· ${l.station}`:""}</div><div style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{l.date} {l.km?`· ${fmt(l.km)} كم`:""}</div></div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{color:"#34d399",fontWeight:900}}>{fmt(l.cost)} جنيه</span><button onClick={()=>upd({fuelLogs:car.fuelLogs.filter(x=>x.id!==l.id)})} style={{color:"rgba(239,68,68,0.5)",background:"none",border:"none",cursor:"pointer",fontSize:15}}>✕</button></div>
          </Panel>
        ))}
      </div>}

      {tab==="parts"&&<div>
        <Panel style={{marginBottom:16}}>
          <SHead icon="🔩" title="إضافة قطعة غيار" />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <Field label="اسم القطعة"><Inp value={newPart.name} onChange={v=>setNewPart(p=>({...p,name:v}))} placeholder="فلتر زيت، تيل فرامل..." /></Field>
            <Field label="التكلفة (جنيه)"><Inp type="number" value={newPart.cost} onChange={v=>setNewPart(p=>({...p,cost:v}))} /></Field>
            <Field label="تاريخ التركيب"><Inp type="date" value={newPart.date} onChange={v=>setNewPart(p=>({...p,date:v}))} /></Field>
            <Field label="الكمية"><Inp type="number" value={newPart.qty} onChange={v=>setNewPart(p=>({...p,qty:v}))} /></Field>
            <Field label="ملاحظات" span={2}><Inp value={newPart.notes} onChange={v=>setNewPart(p=>({...p,notes:v}))} /></Field>
          </div>
          <Btn onClick={()=>{if(!newPart.name)return;upd({parts:[...(car.parts||[]),{...newPart,id:Date.now()}]});setNewPart({name:"",cost:"",date:todayStr(),notes:"",qty:"1"});}} color="#8b5cf6" style={{width:"100%"}}>+ إضافة قطعة</Btn>
        </Panel>
        {(car.parts||[]).length>0&&<div style={{marginBottom:12,padding:14,borderRadius:12,background:"rgba(139,92,246,0.1)",border:"1px solid rgba(139,92,246,0.3)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{color:"rgba(255,255,255,0.5)"}}>إجمالي قطع الغيار</span>
          <span style={{color:"#c4b5fd",fontWeight:900,fontSize:18}}>{fmt(totalPartsCost)} جنيه</span>
        </div>}
        {(car.parts||[]).slice().reverse().map(p=>(
          <Panel key={p.id} style={{marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:"white",fontWeight:700}}>🔩 {p.name} {p.qty>1?"("+p.qty+")":""}</div><div style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{p.date} {p.notes?"· "+p.notes:""}</div></div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{color:"#c4b5fd",fontWeight:900}}>{fmt(p.cost)} جنيه</span><button onClick={()=>upd({parts:car.parts.filter(x=>x.id!==p.id)})} style={{color:"rgba(239,68,68,0.5)",background:"none",border:"none",cursor:"pointer",fontSize:15}}>✕</button></div>
          </Panel>
        ))}
      </div>}

      {tab==="history"&&<HistoryLog car={car} onUpdate={onUpdate} />}
      {tab==="ai"&&<Panel><AIAssistant car={car} /></Panel>}
    </div>
  );
}

// ── Export/Import ──
function exportData(cars) {
  const blob = new Blob([JSON.stringify(cars,null,2)],{type:"application/json"});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`fleet-${todayStr()}.json`; a.click();
}
function importData(setCars, showToast) {
  const input = document.createElement("input"); input.type="file"; input.accept=".json";
  input.onchange = (e:any) => {
  const f = e.target.files[0];
  if (!f) return;

  const r = new FileReader();

  r.onload = (ev:any) => {
    try {
      setCars(JSON.parse(ev.target.result as string));
      showToast("✅ تم الاستيراد");
    } catch {
      showToast("❌ ملف غير صحيح", "#ef4444");
    }
  };

  r.readAsText(f);
};
  input.click();
}
const APP_USER = "admin";
const APP_PASS = "123456";
// ── MAIN ──
export default function App() {
  const [cars, setCars] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [selectedId, setSelectedId] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<any>(null);
const [sideOpen, setSideOpen] = useState(true);
const [loggedIn, setLoggedIn] = useState(false);
const [username, setUsername] = useState("");
const [password, setPassword] = useState("");
const login = () => {
  if (username === APP_USER && password === APP_PASS) {
    setLoggedIn(true);
  } else {
    alert("بيانات الدخول غلط");
  }
};

useEffect(() => {
  const loadCars = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "cars"));

      const firebaseCars = querySnapshot.docs.map((doc) => ({
        ...doc.data(),
      }));

      if (firebaseCars.length > 0) {
        setCars(firebaseCars as any);
      }

    } catch (error) {
      console.log(error);
    }
  };

  loadCars();
}, []);

  const showToast = useCallback((msg, color="#10b981") => { setToast({msg,color}); setTimeout(()=>setToast(null),2600); }, []);

  const addCar = async () => {
    if (cars.length >= 100) { showToast("وصلت للحد الأقصى 100 سيارة","#ef4444"); return; }
    const id = Date.now();
    const car = newCar(id);

await addDoc(collection(db, "cars"), car);
    setCars(p=>[...p,car]);
    setSelectedId(id); setPage("carDetail");
  };

  const updateCar = useCallback(updated => {
    setCars(p=>p.map(c=>c.id===updated.id?updated:c));
    showToast("💾 تم الحفظ");
  }, [showToast]);

  const deleteCar = async (id) => {

  try {

    const querySnapshot = await getDocs(collection(db, "cars"));

    querySnapshot.forEach(async (d) => {
      if (d.data().id === id) {
        await deleteDoc(doc(db, "cars", d.id));
      }
    });

    setCars((p) => p.filter((c) => c.id !== id));

    setPage("dashboard");

    showToast("🗑️ تم الحذف", "#ef4444");

  } catch (error) {
    console.log(error);
  }
};

  const selectedCar = cars.find(c=>c.id===selectedId);
  const alerts = useMemo(()=>buildAlerts(cars),[cars]);
  const dangerN = alerts.filter(a=>a.status==="danger").length;
  const warnN = alerts.filter(a=>a.status==="warning").length;
  const carAlertMap = useMemo(()=>{ const m={}; for(const a of alerts){if(!m[a.carId])m[a.carId]=[];m[a.carId].push(a);} return m; },[alerts]);

  const filtered = cars.filter(c=>{ const q=search.toLowerCase(); return !q||(c.name+c.brand+c.model+c.plate+c.year).toLowerCase().includes(q); });

  const totalFleetCost = cars.reduce((s,c)=> s+(c.parts||[]).reduce((a,p)=>a+ +(p.cost||0),0)+ +(c.oil.cost||0)+ +(c.tires.cost||0)+c.maintenances.reduce((a,m)=>a+ +(m.cost||0),0)+(c.fuelLogs||[]).reduce((a,l)=>a+ +(l.cost||0),0)+ +(c.insurance.cost||0)+ +(c.license.cost||0) ,0);

  const NAV = [{id:"dashboard",icon:"🏠",label:"لوحة التحكم"},{id:"alerts",icon:"🔔",label:"التنبيهات",badge:dangerN+warnN},{id:"analytics",icon:"📊",label:"التحليلات"}];
if (!loggedIn) {
  return (
    <div style={{
      minHeight:"100vh",
      display:"flex",
      justifyContent:"center",
      alignItems:"center",
      background:"#020817"
    }}>
      <div style={{
        width:320,
        background:"#0f172a",
        padding:30,
        borderRadius:20,
        display:"flex",
        flexDirection:"column",
        gap:15
      }}>
        <h2 style={{color:"white",textAlign:"center"}}>
          تسجيل الدخول
        </h2>

        <input
          placeholder="Username"
          value={username}
          onChange={(e)=>setUsername(e.target.value)}
          style={{
            padding:12,
            borderRadius:10,
            border:"none"
          }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          style={{
            padding:12,
            borderRadius:10,
            border:"none"
          }}
        />

        <button
          onClick={login}
          style={{
            padding:12,
            border:"none",
            borderRadius:10,
            background:"#10b981",
            color:"white",
            fontWeight:"bold",
            cursor:"pointer"
          }}
        >
          دخول
        </button>
      </div>
    </div>
  );
}
  return (
    <div dir="rtl" style={{minHeight:"100vh",background:"#0d1117",fontFamily:"'Cairo','Tajawal',sans-serif",display:"flex"}}>
      
  
      {/* SIDEBAR */}
      <div style={{width:sideOpen?230:58,minHeight:"100vh",background:"#111827",borderLeft:"1px solid rgba(255,255,255,0.06)",display:"flex",flexDirection:"column",flexShrink:0,transition:"width 0.22s",overflow:"hidden",position:"sticky",top:0,height:"100vh"}}>
        <div style={{padding:"18px 14px 12px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",gap:10,minHeight:64}}>
          <span style={{fontSize:24,flexShrink:0}}>🚗</span>
          {sideOpen&&<div style={{flex:1,minWidth:0}}><div style={{color:"white",fontWeight:900,fontSize:15,whiteSpace:"nowrap"}}>أسطول سياراتي</div><div style={{color:"rgba(255,255,255,0.28)",fontSize:11}}>{cars.length}/100 سيارة</div></div>}
          <button onClick={()=>setSideOpen(p=>!p)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:16,flexShrink:0,padding:"4px"}}>{sideOpen?"◀":"▶"}</button>
        </div>

        {NAV.map(item=>(
          <button key={item.id} onClick={()=>setPage(item.id)}
            style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:page===item.id?"rgba(249,115,22,0.12)":"transparent",borderRight:page===item.id?"3px solid #f97316":"3px solid transparent",border:"none",cursor:"pointer",color:page===item.id?"#f97316":"rgba(255,255,255,0.45)",fontFamily:"'Cairo',sans-serif",fontWeight:700,fontSize:13,textAlign:"right",width:"100%",whiteSpace:"nowrap",minHeight:44}}>
            <span style={{fontSize:18,flexShrink:0}}>{item.icon}</span>
            {sideOpen&&<><span style={{flex:1}}>{item.label}</span>{item.badge>0&&<span style={{background:"#ef4444",color:"white",borderRadius:20,padding:"1px 7px",fontSize:11}}>{item.badge}</span>}</>}
          </button>
        ))}

        {sideOpen&&<div style={{padding:"10px 14px 4px",fontSize:10,color:"rgba(255,255,255,0.2)",fontWeight:700,letterSpacing:1}}>السيارات ({cars.length})</div>}

        <div style={{flex:1,overflowY:"auto",padding:"0 5px"}}>
          {cars.map(c=>{
            const ca=carAlertMap[c.id]||[];
            const hasDanger=ca.some(a=>a.status==="danger");
            const hasWarn=ca.some(a=>a.status==="warning");
            const isActive=page==="carDetail"&&selectedId===c.id;
            return (
              <button key={c.id} onClick={()=>{setSelectedId(c.id);setPage("carDetail");}}
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:10,background:isActive?"rgba(249,115,22,0.1)":"transparent",border:"none",cursor:"pointer",width:"100%",textAlign:"right",marginBottom:2,minHeight:42}}>
                {c.photo?<img src={c.photo} alt="" style={{width:26,height:26,borderRadius:8,objectFit:"cover",flexShrink:0}} />:<span style={{fontSize:18,flexShrink:0}}>🚙</span>}
                {sideOpen&&<>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:isActive?"#f97316":"rgba(255,255,255,0.65)",fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name||c.brand||"سيارة"}</div>
                    <div style={{color:"rgba(255,255,255,0.25)",fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.plate||c.model||""}</div>
                  </div>
                  {hasDanger&&<span style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",flexShrink:0}} />}
                  {!hasDanger&&hasWarn&&<span style={{width:7,height:7,borderRadius:"50%",background:"#fbbf24",flexShrink:0}} />}
                </>}
              </button>
            );
          })}
        </div>

        <div style={{padding:10,borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",flexDirection:"column",gap:6}}>
          <button onClick={addCar} style={{width:"100%",padding:"9px",borderRadius:12,border:"2px dashed rgba(249,115,22,0.35)",background:"transparent",color:"#f97316",fontFamily:"'Cairo',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <span>+</span>{sideOpen&&"إضافة سيارة"}
          </button>
          {sideOpen&&<div style={{display:"flex",gap:6}}>
            <button onClick={()=>exportData(cars)} style={{flex:1,padding:"7px 0",borderRadius:9,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.45)",fontFamily:"'Cairo',sans-serif",fontSize:11,cursor:"pointer"}}>⬇️ تصدير</button>
            <button onClick={()=>importData(setCars,showToast)} style={{flex:1,padding:"7px 0",borderRadius:9,border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.45)",fontFamily:"'Cairo',sans-serif",fontSize:11,cursor:"pointer"}}>⬆️ استيراد</button>
          </div>}
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,overflowY:"auto",padding:"26px 22px 60px",minHeight:"100vh"}}>

        {page==="dashboard"&&<div style={{animation:"fadeIn 0.3s ease"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22,flexWrap:"wrap",gap:12}}>
            <div><h1 style={{color:"white",fontSize:24,fontWeight:900}}>لوحة التحكم</h1><p style={{color:"rgba(255,255,255,0.3)",fontSize:13,marginTop:3}}>{new Date().toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p></div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 بحث..."
              style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"white",borderRadius:14,padding:"10px 16px",fontFamily:"'Cairo',sans-serif",fontSize:13,outline:"none",width:220}} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
            {[
              {icon:"🚗",label:"إجمالي السيارات",value:cars.length,color:"#3b82f6",sub:"من أصل 100"},
              {icon:"🚨",label:"تنبيهات خطر",value:dangerN,color:"#ef4444",sub:"تحتاج تدخل فوري"},
              {icon:"⚠️",label:"تنبيهات قريبة",value:warnN,color:"#f59e0b",sub:"خلال 30 يوم"},
              {icon:"💰",label:"إجمالي المصاريف",value:`${fmt(totalFleetCost)} ج`,color:"#10b981",sub:"جنيه مصري"},
            ].map(s=><div key={s.label} style={{borderRadius:18,padding:18,background:`${s.color}12`,border:`1px solid ${s.color}28`,cursor:"default"}}>
              <div style={{fontSize:26}}>{s.icon}</div>
              <div style={{color:"white",fontSize:s.value.toString().length>8?18:26,fontWeight:900,marginTop:8,lineHeight:1}}>{s.value}</div>
              <div style={{color:"rgba(255,255,255,0.45)",fontSize:11,marginTop:5}}>{s.label}</div>
              <div style={{color:s.color,fontSize:10,marginTop:2}}>{s.sub}</div>
            </div>)}
          </div>
          {filtered.length===0&&<div style={{textAlign:"center",padding:80,color:"rgba(255,255,255,0.15)"}}>
            <div style={{fontSize:52,marginBottom:14}}>🚗</div>
            <div style={{fontSize:17,fontWeight:700}}>{cars.length===0?"لا توجد سيارات — اضغط + إضافة سيارة":"لا توجد نتائج"}</div>
          </div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:16}}>
            {filtered.map(c=>{
              const ca=carAlertMap[c.id]||[];
              const hasDanger=ca.some(a=>a.status==="danger");
              const hasWarn=ca.some(a=>a.status==="warning");
              const oilR=c.oil.lastKm?+c.oil.lastKm+ +c.oil.intervalKm- +c.currentKm:null;
              const licD=daysBetween(c.license.expiryDate);
              const cost=(c.parts||[]).reduce((s,p)=>s+ +(p.cost||0),0)+ +(c.oil.cost||0)+ +(c.tires.cost||0)+c.maintenances.reduce((s,m)=>s+ +(m.cost||0),0)+(c.fuelLogs||[]).reduce((s,l)=>s+ +(l.cost||0),0);
              return (
                <div key={c.id} className="ccard" onClick={()=>{setSelectedId(c.id);setPage("carDetail");}}
                  style={{borderRadius:20,padding:18,background:hasDanger?"rgba(239,68,68,0.06)":hasWarn?"rgba(251,191,36,0.04)":"rgba(255,255,255,0.04)",border:`1px solid ${hasDanger?"rgba(239,68,68,0.28)":hasWarn?"rgba(251,191,36,0.18)":"rgba(255,255,255,0.08)"}`,cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      {c.photo?<img src={c.photo} alt="" style={{width:44,height:44,borderRadius:11,objectFit:"cover",border:"2px solid rgba(249,115,22,0.3)"}} />:<div style={{width:44,height:44,borderRadius:11,background:"rgba(249,115,22,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,border:"1px solid rgba(249,115,22,0.2)"}}>🚙</div>}
                      <div><div style={{color:"white",fontSize:15,fontWeight:900}}>{c.name||c.brand||"سيارة"}</div><div style={{color:"rgba(255,255,255,0.35)",fontSize:11}}>{c.brand} {c.model} {c.year}</div></div>
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {hasDanger&&<span style={{background:"#ef4444",color:"white",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700}}>🚨{ca.filter(a=>a.status==="danger").length}</span>}
                      {hasWarn&&<span style={{background:"#d97706",color:"white",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700}}>⚠️{ca.filter(a=>a.status==="warning").length}</span>}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                    {[
                      {l:"العداد",v:`${c.currentKm.toLocaleString()} كم`,c:"white"},
                      {l:"رقم اللوحة",v:c.plate||"—",c:"white"},
                      {l:"زيت متبقي",v:oilR!==null?`${oilR.toLocaleString()} كم`:"—",c:oilR!==null?(oilR<0?"#f87171":oilR<500?"#fbbf24":"#34d399"):"white"},
                      {l:"الترخيص",v:licD!==null?`${licD} يوم`:"—",c:licD!==null?(licD<0?"#f87171":licD<=30?"#fbbf24":"#34d399"):"white"},
                      {l:"السائق",v:c.driver?.name||"—",c:"rgba(255,255,255,0.6)"},
                      {l:"إجمالي المصاريف",v:`${fmt(cost)} ج`,c:"#c4b5fd"},
                    ].map(item=>(
                      <div key={item.l} style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"7px 10px"}}>
                        <div style={{color:"rgba(255,255,255,0.3)",fontSize:10}}>{item.l}</div>
                        <div style={{color:item.c,fontWeight:700,fontSize:12,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>}

        {page==="alerts"&&<div style={{animation:"fadeIn 0.3s ease"}}>
          <h1 style={{color:"white",fontSize:24,fontWeight:900,marginBottom:6}}>🔔 التنبيهات</h1>
          <p style={{color:"rgba(255,255,255,0.3)",fontSize:13,marginBottom:22}}>{alerts.length} تنبيه — {dangerN} خطر، {warnN} تحذير</p>
          {alerts.length===0&&<div style={{textAlign:"center",padding:80}}><div style={{fontSize:56,marginBottom:12}}>✅</div><div style={{color:"white",fontSize:18,fontWeight:900}}>كل شيء بخير!</div><div style={{color:"rgba(255,255,255,0.3)",fontSize:13,marginTop:6}}>لا توجد تنبيهات</div></div>}
          {["danger","warning"].map(s=>{
            const group=alerts.filter(a=>a.status===s);
            if(!group.length)return null;
            return <div key={s} style={{marginBottom:26}}>
              <div style={{color:S[s].text,fontWeight:900,fontSize:16,marginBottom:10}}>{s==="danger"?"🚨 تنبيهات عاجلة":"⚠️ تنبيهات قريبة"}</div>
              {group.map((a,i)=>(
                <div key={i} onClick={()=>{setSelectedId(a.carId);setPage("carDetail");}}
                  style={{display:"flex",gap:12,alignItems:"center",padding:"13px 16px",borderRadius:14,background:S[s].bg,border:`1px solid ${S[s].border}`,marginBottom:8,cursor:"pointer",transition:"opacity 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                  <span style={{fontSize:26,flexShrink:0}}>{a.icon}</span>
                  <div style={{flex:1}}><div style={{color:"white",fontWeight:900,fontSize:14}}>{a.title}</div><div style={{color:"rgba(255,255,255,0.45)",fontSize:12}}>{a.carName} {a.plate?`(${a.plate})`:""} · {a.detail}</div></div>
                  <Badge status={s} />
                </div>
              ))}
            </div>;
          })}
        </div>}

        {page==="analytics"&&<div style={{animation:"fadeIn 0.3s ease"}}>
          <h1 style={{color:"white",fontSize:24,fontWeight:900,marginBottom:20}}>📊 التحليلات</h1>
          <Analytics cars={cars} />
        </div>}

        {page==="carDetail"&&selectedCar&&<div style={{animation:"fadeIn 0.3s ease"}}>
          <CarDetail car={selectedCar} onUpdate={updateCar} onBack={()=>setPage("dashboard")} onDelete={()=>deleteCar(selectedCar.id)} />
        </div>}
      </div>

      {toast&&<div style={{position:"fixed",bottom:26,left:"50%",transform:"translateX(-50%)",background:toast.color,padding:"11px 22px",borderRadius:40,color:"white",fontWeight:700,fontSize:13,zIndex:9999,boxShadow:"0 8px 30px rgba(0,0,0,0.5)",whiteSpace:"nowrap",animation:"fadeIn 0.2s ease"}}>{toast.msg}</div>}
    </div>
  );
}
