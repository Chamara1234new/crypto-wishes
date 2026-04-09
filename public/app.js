// ============================================================
//  Crypto Wishes
// ============================================================

function getVisitorId() {
  let id = localStorage.getItem('cw_visitor');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('cw_visitor', id); }
  return id;
}
const visitorId = getVisitorId();
let remainingWishes = 3;
let lastSubmittedText = null;
let bubblesExplored = 0;
let nudgeShown = false;
let allWishes = [];

const CAT = {
  house:      { icon: '🏠', g: ['#f59e0b','#b45309'] },
  travel:     { icon: '✈️',  g: ['#06b6d4','#0e7490'] },
  family:     { icon: '👨‍👩‍👧‍👦', g: ['#ec4899','#be185d'] },
  education:  { icon: '🎓', g: ['#8b5cf6','#6d28d9'] },
  business:   { icon: '🚀', g: ['#10b981','#047857'] },
  car:        { icon: '🏎️',  g: ['#ef4444','#b91c1c'] },
  health:     { icon: '💊', g: ['#14b8a6','#0f766e'] },
  charity:    { icon: '💝', g: ['#f472b6','#be185d'] },
  freedom:    { icon: '🦅', g: ['#a78bfa','#7c3aed'] },
  technology: { icon: '💻', g: ['#3b82f6','#1d4ed8'] },
  art:        { icon: '🎨', g: ['#f97316','#c2410c'] },
  invest:     { icon: '📈', g: ['#22c55e','#15803d'] },
  nature:     { icon: '🌿', g: ['#84cc16','#4d7c0f'] },
  sports:     { icon: '⚽', g: ['#eab308','#a16207'] },
  food:       { icon: '🍕', g: ['#fb923c','#c2410c'] },
  gaming:     { icon: '🎮', g: ['#6366f1','#4338ca'] },
  fashion:    { icon: '👗', g: ['#e879f9','#a21caf'] },
  pet:        { icon: '🐕', g: ['#fbbf24','#b45309'] },
};
function catOf(key) { return CAT[key] || CAT.freedom; }

const $ = id => document.getElementById(id);
const container        = $('bubbles-container');
const addBtn           = $('add-wish-btn');
const modalOverlay     = $('modal-overlay');
const wishForm         = $('wish-form');
const wishInput        = $('wish-input');
const charCurrent      = $('char-current');
const submitBtn        = $('submit-btn');
const formError        = $('form-error');
const statsRow         = $('stats-row');
const totalCountEl     = $('total-count');
const modalFormState   = $('modal-form-state');
const modalSuccessState = $('modal-success-state');
const modalEvangelistState = $('modal-evangelist-state');
const successWishText  = $('success-wish-text');
const successEmoji     = $('success-emoji');
const shareXBtn        = $('share-x-btn');
const anotherWishBtn   = $('another-wish-btn');
const wishesLeftHint   = $('wishes-left-hint');
const confettiCanvas   = $('confetti-canvas');
const detailOverlay    = $('detail-overlay');
const detailColorBar   = $('detail-color-bar');
const detailIconWrap   = $('detail-icon-wrap');
const detailIcon       = $('detail-icon');
const detailText       = $('detail-text');
const detailShareBtn   = $('detail-share-btn');
const modalPrompt      = $('modal-prompt');
const reciprocityNudge = $('reciprocity-nudge');
const nudgeText        = $('nudge-text');
const nudgeBtn         = $('nudge-btn');
const evangelistWishes = $('evangelist-wishes');
const evangelistShareBtn = $('evangelist-share-btn');
const resonateBtn      = $('detail-resonate-btn');
const resonateLabel    = $('resonate-label');
const gate             = $('gate');
const gateBtn          = $('gate-btn');
const gateMessage      = $('gate-message');

let gateOpen = false; // true once all 3 wishes submitted

// ============================================================
//  Init
// ============================================================
async function init() {
  await updateRemaining();

  if (remainingWishes <= 0) {
    // Already submitted all 3 — show bubbles directly
    gateOpen = true;
    gate.classList.add('hidden');
    container.classList.remove('hidden');
    await loadBubbles();
  } else {
    // Gate: show blurred preview, hide bubbles
    gate.classList.remove('hidden');
    container.classList.add('hidden');
    addBtn.classList.add('hidden'); // hide bottom button, gate has its own CTA
    updateGateMessage();
  }
}

function updateGateMessage() {
  const made = 3 - remainingWishes;
  if (made === 0) {
    gateMessage.textContent = 'Share your 3 wishes to see what others are dreaming';
    gateBtn.textContent = 'Make your first wish';
  } else if (made === 1) {
    gateMessage.textContent = '2 more wishes to unlock the dreams';
    gateBtn.textContent = 'Make your second wish';
  } else if (made === 2) {
    gateMessage.textContent = '1 wish left to reveal them all';
    gateBtn.textContent = 'Make your final wish';
  }
}

async function revealBubbles() {
  gateOpen = true;
  gate.classList.add('hidden');
  container.classList.remove('hidden');
  container.classList.add('revealing');
  addBtn.classList.remove('hidden');
  addBtn.textContent = 'Your wishes';
  addBtn.classList.add('exhausted');
  addBtn.classList.remove('pulse');
  await loadBubbles();
}

gateBtn.addEventListener('click', () => {
  openModal();
});

async function updateRemaining() {
  try {
    const data = await (await fetch(`/api/my-wishes/${visitorId}`)).json();
    remainingWishes = data.remaining;
    if (remainingWishes <= 0 && gateOpen) {
      addBtn.textContent = 'Your wishes';
      addBtn.classList.add('exhausted');
      addBtn.classList.remove('pulse');
    }
  } catch(e) { console.error(e); }
}

// ============================================================
//  Bubbles
// ============================================================
async function loadBubbles() {
  try {
    const wishes = await (await fetch(`/api/wishes?vid=${visitorId}`)).json();
    allWishes = wishes;

    const total = wishes.reduce((s,w) => s + w.count, 0);
    if (total > 0) {
      totalCountEl.textContent = total;
      statsRow.classList.remove('hidden');
    }

    const loader = $('bubbles-loading');
    if (loader) loader.remove();

    if (!wishes.length) {
      container.innerHTML = '<div class="empty-state"><div class="icon">&#10024;</div><p>No wishes yet.<br>Be the first to dream!</p></div>';
      return;
    }

    renderBubbles(wishes);
  } catch(e) { console.error(e); }
}

function renderBubbles(wishes) {
  container.innerHTML = '';

  const width = Math.min(940, window.innerWidth - 16);
  const height = Math.max(500, Math.min(900, wishes.length * 65));

  const hierarchy = d3.hierarchy({
    children: wishes.map(w => ({ ...w, value: Math.pow(Math.max(w.count, 1), 1.6) }))
  }).sum(d => d.value);

  const root = d3.pack().size([width, height]).padding(6)(hierarchy);

  const svg = d3.select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const defs = svg.append('defs');

  root.leaves().forEach((d, i) => {
    const c = catOf(d.data.category);
    const grad = defs.append('radialGradient').attr('id', `g${i}`).attr('cx','30%').attr('cy','30%');
    grad.append('stop').attr('offset','0%').attr('stop-color', c.g[0]).attr('stop-opacity', 0.75);
    grad.append('stop').attr('offset','100%').attr('stop-color', c.g[1]).attr('stop-opacity', 0.3);
  });

  const groups = svg.selectAll('.bubble-group')
    .data(root.leaves()).join('g')
    .attr('class', 'bubble-group')
    .style('--bx', d => `${d.x}px`).style('--by', d => `${d.y}px`)
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('animation-delay', (d,i) => `${i * 50}ms`);

  // Ambient glow — warm on high-resonance
  groups.append('circle')
    .attr('r', d => (d.data.resonances || 0) >= 3 ? d.r + 12 : d.r + 6)
    .attr('fill', (d,i) => (d.data.resonances || 0) >= 3 ? 'rgba(236,72,153,0.25)' : `url(#g${i})`)
    .attr('opacity', d => (d.data.resonances || 0) >= 3 ? 0.35 : 0.15)
    .style('pointer-events','none');

  // Main circle
  groups.append('circle').attr('class','bubble-circle').attr('r', d => d.r)
    .attr('fill', (d,i) => `url(#g${i})`).attr('stroke','rgba(255,255,255,0.06)').attr('stroke-width',1);

  // Resonance ring
  groups.filter(d => (d.data.resonances || 0) >= 3).append('circle')
    .attr('class','bubble-resonance-ring').attr('r', d => d.r + 1)
    .attr('fill','none').attr('stroke','rgba(236,72,153,0.3)').attr('stroke-width', 1.5);

  // "Mine" ring
  groups.filter(d => d.data.mine).append('circle')
    .attr('class','bubble-mine-ring').attr('r', d => d.r + 2)
    .attr('fill','none').attr('stroke','rgba(255,255,255,0.5)')
    .attr('stroke-width',2).attr('stroke-dasharray','4 3');

  // Click
  groups.on('click', function(ev, d) {
    ev.stopPropagation();
    openDetail(d.data);
    trackExploration();
  });

  // Bubble content
  groups.each(function(d) {
    const g = d3.select(this);
    const r = d.r;
    const c = catOf(d.data.category);

    if (r < 28) {
      g.append('text').attr('class','bubble-icon')
        .attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size', `${Math.max(14, r * 0.55)}px`).text(c.icon);
    } else if (r < 55) {
      g.append('text').attr('class','bubble-icon').attr('y', -r * 0.12)
        .attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size', `${Math.max(20, r * 0.4)}px`).text(c.icon);
      g.append('text').attr('class','bubble-label').attr('y', r * 0.32)
        .style('font-size', `${Math.max(9, r * 0.18)}px`)
        .text(truncate(d.data.text, 18));
    } else {
      const iconSz = Math.max(24, r * 0.3);
      const fsz = Math.max(11, Math.min(15, r * 0.17));
      const gap = 6;
      const lines = wrapText(g, d.data.text, fsz, r * 1.4, 2);
      const lh = fsz * 1.35;
      const bh = iconSz + gap + lines.length * lh;
      const ty = -bh / 2;

      g.append('text').attr('class','bubble-icon').attr('y', ty + iconSz * 0.5)
        .attr('text-anchor','middle').attr('dominant-baseline','central')
        .style('font-size', `${iconSz}px`).text(c.icon);

      const tsy = ty + iconSz + gap + fsz * 0.4;
      lines.forEach((ln,i) => {
        g.append('text').attr('class','bubble-label').attr('y', tsy + i * lh)
          .style('font-size', `${fsz}px`).text(ln);
      });
    }
  });

  // Post-submit: scroll to new bubble + highlight
  if (lastSubmittedText) {
    const match = groups.filter(d => d.data.text.toLowerCase() === lastSubmittedText.toLowerCase());
    if (!match.empty()) {
      const d = match.datum();
      const svgEl = svg.node();
      const rect = svgEl.getBoundingClientRect();
      const scale = rect.width / width;
      const absY = rect.top + window.scrollY + d.y * scale;
      window.scrollTo({ top: absY - window.innerHeight / 2, behavior: 'smooth' });
      match.append('circle').attr('class','bubble-highlight').attr('r', d.r)
        .attr('stroke', catOf(d.data.category).g[0]);
    }
    lastSubmittedText = null;
  }

  // Upward drift
  groups.each(function(d) {
    const el = d3.select(this);
    const weight = Math.max(0.5, 1 - (d.r / 200));
    const dur = 3000 + (1 - weight) * 3000;
    const dy = 4 * weight + 2;
    const dx = 1.5 * weight;

    function rise() {
      el.transition().duration(dur).ease(d3.easeSinInOut)
        .attr('transform', `translate(${d.x + dx},${d.y - dy})`)
        .transition().duration(dur * 1.1).ease(d3.easeSinInOut)
        .attr('transform', `translate(${d.x - dx},${d.y + dy * 0.3})`)
        .on('end', rise);
    }
    setTimeout(rise, Math.random() * 2000);
  });
}

function truncate(s, n) { return s.length <= n ? s : s.slice(0, n-1) + '\u2026'; }
function wrapText(g, text, fs, maxW, maxL) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  const tmp = g.append('text').style('font-size',`${fs}px`).style('visibility','hidden');
  words.forEach(w => {
    const t = cur ? cur+' '+w : w; tmp.text(t);
    if (tmp.node().getComputedTextLength() > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  });
  if (cur) lines.push(cur); tmp.remove();
  const d = lines.slice(0, maxL);
  if (lines.length > maxL) d[maxL-1] += '\u2026';
  return d;
}

// ============================================================
//  Reciprocity nudge
// ============================================================
function trackExploration() {
  if (nudgeShown || remainingWishes <= 0) return;
  bubblesExplored++;
  if (bubblesExplored >= 3) {
    nudgeText.textContent = `You've read ${bubblesExplored} dreams.`;
    reciprocityNudge.classList.remove('hidden');
    nudgeShown = true;
  }
}

nudgeBtn.addEventListener('click', () => {
  reciprocityNudge.classList.add('hidden');
  openModal();
});

// ============================================================
//  Share — Rory's reframe
// ============================================================
function shareOnX(wishText) {
  const text = `If crypto changed my life, I'd ${wishText}\n\nWhat would you wish for?`;
  const url = window.location.origin;
  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
}

function shareAllWishes(myWishes) {
  const list = myWishes.map((w,i) => `${i+1}. ${w.text}`).join('\n');
  const text = `My 3 crypto wishes:\n${list}\n\nWhat are yours?`;
  const url = window.location.origin;
  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
}

// ============================================================
//  Detail card — stripped to essentials
// ============================================================
function openDetail(data) {
  const c = catOf(data.category);
  detailColorBar.style.background = `linear-gradient(90deg, ${c.g[0]}, ${c.g[1]})`;
  detailIconWrap.style.background = `${c.g[0]}18`;
  detailIcon.textContent = c.icon;
  detailText.textContent = data.text;

  // Share hidden by default — revealed after resonating
  detailShareBtn.classList.add('hidden');
  detailShareBtn.onclick = () => shareOnX(data.text);

  if (data.resonated) {
    resonateBtn.classList.add('resonated');
    resonateLabel.textContent = 'You resonated';
    resonateBtn.onclick = null;
    detailShareBtn.classList.remove('hidden');
  } else {
    resonateBtn.classList.remove('resonated');
    resonateLabel.textContent = 'This resonates with me';
    resonateBtn.onclick = () => resonate(data);
  }

  detailOverlay.classList.remove('hidden');
}

async function resonate(data) {
  resonateBtn.classList.add('resonated');
  resonateLabel.textContent = 'You resonated';
  resonateBtn.onclick = null;
  data.resonated = true;

  // Reveal share — you earn it by feeling something first
  detailShareBtn.classList.remove('hidden');

  try {
    await fetch('/api/resonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: data.text, visitorId })
    });
  } catch(e) { console.error(e); }
}

function closeDetail() { detailOverlay.classList.add('hidden'); }
$('detail-close').addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', e => { if (e.target === detailOverlay) closeDetail(); });

// ============================================================
//  Modal
// ============================================================
function hideAllModalStates() {
  [modalFormState, modalSuccessState, modalEvangelistState].forEach(s => s.classList.add('hidden'));
}

function openModal() {
  if (remainingWishes <= 0) {
    hideAllModalStates();
    showEvangelistState();
    modalOverlay.classList.remove('hidden');
    return;
  }
  showFormState();
  modalOverlay.classList.remove('hidden');
  setTimeout(() => wishInput.focus(), 80);
}

addBtn.addEventListener('click', openModal);
$('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!detailOverlay.classList.contains('hidden')) return closeDetail();
  if (!modalOverlay.classList.contains('hidden')) return closeModal();
});

function closeModal() {
  modalOverlay.classList.add('hidden');
  wishInput.value = '';
  charCurrent.textContent = '0';
}

function showFormState() {
  hideAllModalStates();
  modalFormState.classList.remove('hidden');
  formError.classList.add('hidden');

  const n = 3 - remainingWishes + 1;
  if (n === 1) modalPrompt.textContent = "What's your first wish?";
  else if (n === 2) modalPrompt.textContent = "What's your second wish?";
  else modalPrompt.textContent = "Your final wish.";
}

// --- Submit: no confirmation, no reveal, just send and show the bubble ---
wishForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = wishInput.value.trim();
  if (!text) return;

  submitBtn.disabled = true;
  formError.classList.add('hidden');

  try {
    const res = await fetch('/api/wishes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, visitorId })
    });
    const data = await res.json();

    if (!res.ok) {
      formError.textContent = data.error || 'Something went wrong';
      formError.classList.remove('hidden');
      return;
    }

    lastSubmittedText = text;
    wishInput.value = '';
    charCurrent.textContent = '0';

    await updateRemaining();

    if (remainingWishes <= 0) {
      // Last wish — close, reveal bubbles, then show evangelist
      closeModal();
      lastSubmittedText = text;
      await revealBubbles();
      setTimeout(() => {
        showEvangelistState();
        modalOverlay.classList.remove('hidden');
      }, 2000);
    } else if (!gateOpen) {
      // Still behind the gate — close modal, update gate message
      closeModal();
      updateGateMessage();
    } else {
      // Gate already open — close modal, show bubble
      closeModal();
      await loadBubbles();
    }
  } catch(err) {
    formError.textContent = 'Network error. Try again.';
    formError.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Evangelist state ---
function showEvangelistState() {
  hideAllModalStates();
  modalEvangelistState.classList.remove('hidden');

  const myWishes = allWishes.filter(w => w.mine);
  evangelistWishes.innerHTML = '';

  myWishes.forEach(w => {
    const c = catOf(w.category);
    const el = document.createElement('div');
    el.className = 'evangelist-wish';
    el.innerHTML = `
      <span class="evangelist-wish-icon">${c.icon}</span>
      <span class="evangelist-wish-text">${w.text}</span>
      <span class="evangelist-wish-count">${w.count > 1 ? w.count + ' dreamers' : '1 dreamer'}</span>
    `;
    evangelistWishes.appendChild(el);
  });

  evangelistShareBtn.onclick = () => shareAllWishes(myWishes);
}

wishInput.addEventListener('input', () => { charCurrent.textContent = wishInput.value.length; });

// ============================================================
//  Confetti (kept minimal — only on final wish)
// ============================================================
// Removed. Confidence is quiet.

// ============================================================
//  Resize
// ============================================================
let rsz;
window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(loadBubbles, 300); });

init();
