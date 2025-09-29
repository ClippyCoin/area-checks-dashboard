const QUOTES=[
  "Keep it running, keep it safe.",
  "Fix it right, fix it once.",
  "Little checks prevent big stops.",
  "Clean, tighten, test, repeat.",
  "Best plant day, every day."
];

function pickQuote(){return QUOTES[Math.floor(Math.random()*QUOTES.length)];}

function startQuoteRotation(elId,intervalMs=6000){
  const el=document.getElementById(elId);
  function setQuote(){
    el.style.opacity="0";
    setTimeout(()=>{
      el.textContent=pickQuote();
      el.style.opacity="1";
    },150);
  }
  setQuote();
  return setInterval(setQuote,intervalMs);
}

function renderCountdown(elId,label,endIso){
  const el=document.getElementById(elId);
  const end=new Date(endIso).getTime();
  function tick(){
    const now=Date.now();
    const diff=Math.max(0,end-now);
    const s=Math.floor(diff/1000)%60;
    const m=Math.floor(diff/60000)%60;
    const h=Math.floor(diff/3600000)%24;
    const d=Math.floor(diff/86400000);
    el.querySelector(".cdl").textContent=label;
    el.querySelector(".cdv").textContent=`${d}d ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }
  tick();
  return setInterval(tick,1000);
}
