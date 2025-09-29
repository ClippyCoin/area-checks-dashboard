const QUOTES=[
  "Keep it running, keep it safe.",
  "Fix it right, fix it once.",
  "Little checks prevent big stops.",
  "Clean, tighten, test, repeat.",
  "Best plant day, every day.",
  "If you don't schedule maintenance, your line will.",
  "Quality work shows when nobody is watching."
];
function buildMarquee(containerId){
  const c=document.getElementById(containerId);
  if(!c) return;
  const row=[...QUOTES,...QUOTES,...QUOTES].map(q=>`<span>${q}</span>`).join('<span>•</span>');
  c.innerHTML=`<div class="marquee">${row}</div>`;
}
