import{r as p,j as e}from"./vendor-react-TX_xAmNZ.js";import{D as P,C as A,W as C}from"./DashboardLayout-Bc6lVVOc.js";import{c as k,u as I,P as _,E as R,C as K,B as v,s as S,t as u}from"./index-BQHaPDYN.js";import{C as q}from"./circle-alert-CjcjjvUX.js";import{C as y}from"./copy-DFWOpVtm.js";import{E}from"./eye-off-CD48O4ek.js";import{G as O}from"./globe-Ns-Ktexn.js";import{K as f}from"./key-jZ0sRIGo.js";import{R as b}from"./refresh-cw-TJJroA-a.js";import{S as Y}from"./shield-CnA19-_V.js";import{S as U}from"./shopping-cart-nM8B7uUS.js";import{Z as G}from"./zap-B3lxu9NR.js";import"./vendor-query-WCsZe6Dt.js";const M=[["path",{d:"m18 16 4-4-4-4",key:"1inbqp"}],["path",{d:"m6 8-4 4 4 4",key:"15zrgr"}],["path",{d:"m14.5 4-5 16",key:"e7oirm"}]],T=k("code-xml",M);const B=[["path",{d:"M11 5h10",key:"1cz7ny"}],["path",{d:"M11 12h10",key:"1438ji"}],["path",{d:"M11 19h10",key:"11t30w"}],["path",{d:"M4 4h1v5",key:"10yrso"}],["path",{d:"M4 9h2",key:"r1h2o0"}],["path",{d:"M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02",key:"xtkcd5"}]],g=k("list-ordered",B),$="https://ejftttgovinaujrndona.supabase.co",N=`${$}/functions/v1/public-api`;function L(){const t="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",a=new Uint8Array(48);return crypto.getRandomValues(a),Array.from(a,c=>t[c%t.length]).join("")}function re(){const{user:t,profile:a,refreshProfile:c}=I(),[r,x]=p.useState(!1),[i,h]=p.useState(!1),[o,l]=p.useState(!1),s=a?.api_key??null,j=async()=>{if(t){x(!0);try{const d=L(),{error:w}=await S.from("profiles").update({api_key:d}).eq("user_id",t.id);if(w)throw w;await c(),u.success("API Key generated successfully!"),h(!0)}catch(d){u.error(d.message||"Failed to generate API key")}finally{x(!1)}}},n=async d=>{await navigator.clipboard.writeText(d),l(!0),u.success("Copied to clipboard!"),setTimeout(()=>l(!1),2e3)},z=s?s.slice(0,8)+"••••••••••••••••••••••••••••••••"+s.slice(-6):null;return e.jsxs(P,{children:[e.jsx(_,{title:"API Access & Reseller Docs",description:"Generate your Boostly Pro API key and integrate our SMM services into your own panel or workflow.",canonicalPath:"/api-access",noIndex:!0}),e.jsxs("div",{className:"max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-10",children:[e.jsxs("div",{className:"relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-950/80 via-zinc-900 to-zinc-950 border border-white/[0.07] p-6 sm:p-8",children:[e.jsxs("div",{className:"relative z-10 flex items-start gap-4",children:[e.jsx("div",{className:"w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center shadow-lg shrink-0",children:e.jsx(T,{className:"h-7 w-7 text-white"})}),e.jsxs("div",{children:[e.jsx("h1",{className:"text-2xl sm:text-3xl font-bold text-white tracking-tight",children:"API Access"}),e.jsx("p",{className:"text-sm text-zinc-400 mt-1 max-w-xl",children:"Generate your API key and use it in your own panel — same services, same rates."})]})]}),e.jsx("div",{className:"absolute top-0 right-0 w-56 h-56 bg-violet-600/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4"})]}),e.jsxs("div",{className:"rounded-2xl bg-zinc-950 border border-white/[0.07] p-6 space-y-5",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(f,{className:"h-4 w-4 text-violet-400"}),e.jsx("h2",{className:"text-base font-semibold text-white",children:"Your API Key"})]}),s?e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{className:"flex items-center gap-2 p-4 rounded-xl bg-zinc-900 border border-white/[0.05] group",children:[e.jsx("code",{className:"flex-1 text-[13px] font-mono text-violet-300 truncate select-all",children:i?s:z}),e.jsx("button",{onClick:()=>h(!i),className:"shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1.5 rounded-lg hover:bg-white/5",title:i?"Hide key":"Show key",children:i?e.jsx(E,{className:"h-4 w-4"}):e.jsx(R,{className:"h-4 w-4"})}),e.jsx("button",{onClick:()=>n(s),className:"shrink-0 text-zinc-500 hover:text-violet-400 transition-colors p-1.5 rounded-lg hover:bg-violet-500/10",title:"Copy",children:o?e.jsx(K,{className:"h-4 w-4 text-green-400"}):e.jsx(y,{className:"h-4 w-4"})})]}),e.jsxs("div",{className:"flex items-center gap-2 text-xs text-zinc-500 px-1",children:[e.jsx(Y,{className:"h-3.5 w-3.5 text-amber-500/80"}),e.jsx("span",{children:"Keep this key secret. Do not share it with anyone."})]}),e.jsxs(v,{variant:"outline",size:"sm",onClick:j,disabled:r,className:"text-zinc-400 border-white/[0.07] hover:text-white hover:bg-white/5 hover:border-white/[0.12]",children:[r?e.jsx(b,{className:"h-3.5 w-3.5 mr-2 animate-spin"}):e.jsx(b,{className:"h-3.5 w-3.5 mr-2"}),"Regenerate Key"]})]}):e.jsxs("div",{className:"text-center py-10 space-y-4",children:[e.jsx("div",{className:"w-16 h-16 rounded-2xl bg-zinc-900 border border-white/[0.05] flex items-center justify-center mx-auto",children:e.jsx(f,{className:"h-7 w-7 text-zinc-600"})}),e.jsxs("div",{children:[e.jsx("p",{className:"text-white font-medium",children:"No API key yet"}),e.jsx("p",{className:"text-sm text-zinc-500 mt-1",children:"Generate one using the button below"})]}),e.jsxs(v,{onClick:j,disabled:r,className:"bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-600/20",children:[r?e.jsx(b,{className:"h-4 w-4 mr-2 animate-spin"}):e.jsx(G,{className:"h-4 w-4 mr-2"}),"Generate API Key"]})]})]}),e.jsxs("div",{className:"rounded-2xl bg-zinc-950 border border-white/[0.07] p-6 space-y-4",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(O,{className:"h-4 w-4 text-sky-400"}),e.jsx("h2",{className:"text-base font-semibold text-white",children:"API Base URL"})]}),e.jsxs("div",{className:"flex items-center gap-2 p-4 rounded-xl bg-zinc-900 border border-white/[0.05]",children:[e.jsx("code",{className:"flex-1 text-[13px] font-mono text-sky-300 break-all",children:N}),e.jsx("button",{onClick:()=>n(N),className:"shrink-0 text-zinc-500 hover:text-sky-400 transition-colors p-1.5 rounded-lg hover:bg-sky-500/10",children:e.jsx(y,{className:"h-4 w-4"})})]})]}),e.jsxs("div",{className:"rounded-2xl bg-zinc-950 border border-white/[0.07] p-6 space-y-6",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(g,{className:"h-4 w-4 text-blue-400"}),e.jsx("h2",{className:"text-base font-semibold text-white",children:"API Endpoints"})]}),e.jsxs("div",{className:"flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20",children:[e.jsx(q,{className:"h-4 w-4 text-amber-400 mt-0.5 shrink-0"}),e.jsxs("p",{className:"text-xs text-amber-200/70",children:["Send all requests using the ",e.jsx("code",{className:"bg-amber-500/10 px-1 py-0.5 rounded text-amber-300",children:"POST"})," method and include the ",e.jsx("code",{className:"bg-amber-500/10 px-1 py-0.5 rounded text-amber-300",children:"key"})," field in the body."]})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx(m,{icon:e.jsx(g,{className:"h-4 w-4 text-blue-400"}),method:"POST",action:"services",label:"Services List",description:"View all available services and their rates",request:`{
  "key": "YOUR_API_KEY",
  "action": "services"
}`,response:`{
  "status": "ok",
  "services": [
    {
      "service": 1001,
      "name": "Instagram Followers",
      "category": "Instagram",
      "rate": "0.50",
      "min": 100,
      "max": 50000
    }
  ]
}`,onCopyRequest:()=>n(`{
  "key": "${s||"YOUR_API_KEY"}",
  "action": "services"
}`)}),e.jsx(m,{icon:e.jsx(U,{className:"h-4 w-4 text-violet-400"}),method:"POST",action:"add",label:"Place Order",description:"Place a new order (amount will be deducted from your wallet)",request:`{
  "key": "YOUR_API_KEY",
  "action": "add",
  "service": 1001,
  "link": "https://instagram.com/p/...",
  "quantity": 1000
}`,response:`{
  "status": "ok",
  "order": 78432
}`,onCopyRequest:()=>n(`{
  "key": "${s||"YOUR_API_KEY"}",
  "action": "add",
  "service": 1001,
  "link": "https://instagram.com/p/...",
  "quantity": 1000
}`)}),e.jsx(m,{icon:e.jsx(A,{className:"h-4 w-4 text-sky-400"}),method:"POST",action:"status",label:"Order Status",description:"Check the status of any order",request:`{
  "key": "YOUR_API_KEY",
  "action": "status",
  "order": 78432
}`,response:`{
  "status": "ok",
  "order": {
    "order_number": 78432,
    "status": "processing",
    "quantity": 1000,
    "remains": 250,
    "service": "Instagram Followers"
  }
}`,onCopyRequest:()=>n(`{
  "key": "${s||"YOUR_API_KEY"}",
  "action": "status",
  "order": 78432
}`)}),e.jsx(m,{icon:e.jsx(C,{className:"h-4 w-4 text-amber-400"}),method:"POST",action:"balance",label:"Check Balance",description:"Check your wallet balance",request:`{
  "key": "YOUR_API_KEY",
  "action": "balance"
}`,response:`{
  "status": "ok",
  "balance": "2120.90",
  "currency": "INR"
}`,onCopyRequest:()=>n(`{
  "key": "${s||"YOUR_API_KEY"}",
  "action": "balance"
}`)})]})]})]})]})}function m({icon:t,action:a,label:c,description:r,request:x,response:i,onCopyRequest:h}){const[o,l]=p.useState("request");return e.jsxs("div",{className:"rounded-xl border border-white/[0.06] overflow-hidden",children:[e.jsxs("div",{className:"flex items-center gap-3 px-4 py-3 bg-zinc-900/60",children:[e.jsx("div",{className:"flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.04]",children:t}),e.jsxs("div",{className:"flex-1 min-w-0",children:[e.jsx("p",{className:"text-[13px] font-semibold text-white",children:c}),e.jsx("p",{className:"text-[11px] text-zinc-500",children:r})]}),e.jsxs("span",{className:"text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-1 rounded-md border border-white/[0.05]",children:['action: "',a,'"']})]}),e.jsxs("div",{className:"flex border-b border-white/[0.05] bg-zinc-950",children:[e.jsx("button",{onClick:()=>l("request"),className:`flex-1 py-2 text-[12px] font-medium transition-colors ${o==="request"?"text-white border-b-2 border-violet-500 bg-violet-500/5":"text-zinc-600 hover:text-zinc-400"}`,children:"Request"}),e.jsx("button",{onClick:()=>l("response"),className:`flex-1 py-2 text-[12px] font-medium transition-colors ${o==="response"?"text-white border-b-2 border-blue-500 bg-blue-500/5":"text-zinc-600 hover:text-zinc-400"}`,children:"Response"})]}),e.jsxs("div",{className:"relative bg-[#0d0d0d] p-4 group",children:[e.jsx("pre",{className:"text-[12px] font-mono text-zinc-300 whitespace-pre overflow-x-auto",children:o==="request"?x:i}),o==="request"&&e.jsx("button",{onClick:h,className:"absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5",children:e.jsx(y,{className:"h-3.5 w-3.5"})})]})]})}export{re as default};
