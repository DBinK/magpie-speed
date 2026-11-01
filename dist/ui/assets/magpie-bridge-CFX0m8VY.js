(()=>{const d=new Map;let b=0;const g=[];let c=null;const m=[];function i(e,t){const r=++b;return new Promise((n,l)=>{d.set(r,{resolve:n,reject:l}),parent.postMessage({magpie:1,id:r,method:e,params:t},"*")})}function h(e){const t=document.documentElement;t.dataset.theme=e.dark?"dark":"light",t.style.colorScheme=e.dark?"dark":"light",t.lang=e.lang||"en";for(const[r,n]of Object.entries(e.tokens||{}))t.style.setProperty("--magpie-"+r,n)}addEventListener("message",e=>{if(e.source!==parent)return;const t=e.data;if(!t||t.magpie!==1)return;if(t.event==="theme"){o.theme=t.data,h(t.data);for(const n of g)try{n(t.data)}catch(l){a(l)}return}if(t.event==="action"){c?u(t.data):m.push(t.data);return}const r=d.get(t.id);r&&(d.delete(t.id),t.error?r.reject(new Error(t.error)):r.resolve(t.result))});function a(e){parent.postMessage({magpie:1,method:"error",params:{message:String(e?.message||e)}},"*")}let s=!1;addEventListener("error",e=>{if(/ResizeObserver loop/.test(e.message)||s&&!e.error&&!e.filename){e.preventDefault();return}a(e.error||(e.message==="Script error."?"":e.message))}),addEventListener("unhandledrejection",e=>a(e.reason));function u(e){try{Promise.resolve(c(e)).catch(a)}catch(t){a(t)}}const o={theme:null,context:{},service:"",onTheme(e){g.push(e)},onAction(e){c=e;for(const t of m.splice(0))u(t)},options:{get:()=>i("options.get"),set:e=>i("options.set",{options:e})},read:(e,t)=>i("read",{name:e,params:t})};o.ready=i("hello").then(({context:e,service:t,...r})=>{o.theme=r,o.context=e||{},o.service="";try{t&&(o.service=new URL(t,location.href).href)}catch{}return h(r),r});let f=-1;const x=()=>{const e=Math.ceil(document.documentElement.getBoundingClientRect().height);e!==f&&(f=e,parent.postMessage({magpie:1,method:"size",params:{height:e}},"*"))},v=()=>{new ResizeObserver(()=>{s||(s=!0,setTimeout(()=>{s=!1})),x()}).observe(document.documentElement),x()};document.readyState==="loading"?addEventListener("DOMContentLoaded",v):v();const p=document.createElement("style");p.dataset.magpie="base",p.textContent=`
:where(html) { background: var(--magpie-bg, Canvas); color: var(--magpie-fg, CanvasText); font: 13px/1.45 var(--magpie-font, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif); -webkit-font-smoothing: antialiased; }
:where(body) { margin: 0; padding: 20px 24px; }
:where(h1, h2, h3, h4) { font-weight: 600; margin: 0 0 8px; letter-spacing: -.01em; }
:where(h1) { font-size: 20px; } :where(h2) { font-size: 15px; } :where(h3, h4) { font-size: 13px; }
:where(p) { margin: 0 0 8px; }
:where(small, .muted) { color: var(--magpie-muted, GrayText); }
:where(a) { color: var(--magpie-accent, LinkText); text-decoration: none; }
:where(a:hover) { text-decoration: underline; }
:where(button, input, textarea, select) { font: inherit; color: inherit; }
:where(button) { background: var(--magpie-card, ButtonFace); border: 1px solid var(--magpie-line, ButtonBorder); border-radius: 6px; padding: 3px 10px; }
:where(button:hover:not(:disabled)) { border-color: var(--magpie-muted, ButtonBorder); }
:where(button[aria-pressed="true"], button[aria-selected="true"]) { background: var(--magpie-accent-soft, Highlight); border-color: transparent; color: var(--magpie-accent, HighlightText); }
:where(button:disabled) { opacity: .5; }
:where(input, textarea, select) { background: var(--magpie-card, Field); border: 1px solid var(--magpie-line, ButtonBorder); border-radius: 6px; padding: 4px 8px; }
:where(:focus-visible) { outline: 2px solid var(--magpie-accent, Highlight); outline-offset: 1px; }
:where(table) { border-collapse: collapse; width: 100%; }
:where(th) { text-align: left; font-weight: 500; font-size: 12px; color: var(--magpie-muted, GrayText); }
:where(th, td) { padding: 6px 8px; border-bottom: 1px solid var(--magpie-line, ButtonBorder); }
:where(code, kbd, pre) { font-family: var(--magpie-code, ui-monospace, Menlo, monospace); font-size: 12px; }
:where(pre) { background: var(--magpie-card, Canvas); border: 1px solid var(--magpie-line, ButtonBorder); border-radius: 8px; padding: 8px 10px; overflow: auto; }
:where(hr) { border: 0; border-top: 1px solid var(--magpie-line, ButtonBorder); margin: 12px 0; }
:where(::selection) { background: var(--magpie-accent-soft, Highlight); }
`,(document.head||document.documentElement).prepend(p),window.magpie=o})();
