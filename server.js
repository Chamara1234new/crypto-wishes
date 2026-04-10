const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy for real IP
app.set('trust proxy', true);

// OpenAI client (lazy init)
let openai = null;
function getOpenAI() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Database setup — use /data on Railway (persistent volume), local dir otherwise
const fs = require('fs');
const dbDir = fs.existsSync('/data') ? '/data' : __dirname;
const db = new Database(path.join(dbDir, 'wishes.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS wishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add ip column if missing (existing DBs)
try { db.exec(`ALTER TABLE wishes ADD COLUMN ip TEXT NOT NULL DEFAULT ''`); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS resonances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wish_text TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wish_text, visitor_id)
  )
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: get client IP
function getIP(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

// Valid category keys
const VALID_CATEGORIES = [
  'house', 'travel', 'family', 'education', 'business', 'car',
  'health', 'charity', 'freedom', 'technology', 'art', 'invest',
  'nature', 'sports', 'food', 'gaming', 'fashion', 'pet'
];

// AI-powered category detection
async function detectCategory(text) {
  const client = getOpenAI();
  if (!client) return keywordFallback(text);

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 20,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Classify wishes into ONE category. Reply with ONLY the key.\n\nCategories: ${VALID_CATEGORIES.join(', ')}\n\nRules:\n- house: any place to live — house, flat, apartment, villa, condo, balcony, penthouse\n- travel: seeing the world, exploring, visiting places\n- family: anything for family, parents, kids, relatives, connections with loved ones\n- education: learning, degrees, school\n- business: company, startup, team, product, users, studio, atelier, shop\n- car: vehicles\n- health: medical, wellness, mental health\n- charity: helping others, causes, NGOs, making the world better, volunteering, raising money for organizations\n- freedom: ONLY financial freedom, early retirement, earning X amount, quitting job, debt-free, independence\n- technology: coding, software, AI\n- art: music, painting, writing, film, creative work\n- invest: stocks, crypto trading, generational wealth, portfolio\n- nature: farming, land, outdoors, animals\n- sports: athletics, fitness, gym\n- food: restaurant, cafe, cooking, bakery\n- gaming: video games, esports\n- fashion: clothing, jewelry, luxury brands\n- pet: dogs, cats, animal rescue\n\nCRITICAL: Do NOT default to "freedom". Only use "freedom" for wishes explicitly about financial independence or earning money. For vague/abstract wishes, find the CLOSEST specific category.`
        },
        { role: 'user', content: 'Pretty flat with a balcony' },
        { role: 'assistant', content: 'house' },
        { role: 'user', content: 'To raise money for Pelagos' },
        { role: 'assistant', content: 'charity' },
        { role: 'user', content: 'Fancy atelier for the girls' },
        { role: 'assistant', content: 'business' },
        { role: 'user', content: 'For Nabu to get millions of users' },
        { role: 'assistant', content: 'business' },
        { role: 'user', content: 'be able to give to my relatives' },
        { role: 'assistant', content: 'family' },
        { role: 'user', content: 'To build the best team and culture' },
        { role: 'assistant', content: 'business' },
        { role: 'user', content: 'make the world a better place' },
        { role: 'assistant', content: 'charity' },
        { role: 'user', content: 'Connection' },
        { role: 'assistant', content: 'family' },
        { role: 'user', content: 'get a degree in computer science' },
        { role: 'assistant', content: 'education' },
        { role: 'user', content: 'retire at 30' },
        { role: 'assistant', content: 'freedom' },
        { role: 'user', content: text }
      ]
    });

    let category = res.choices[0].message.content.trim().toLowerCase();
    if (!VALID_CATEGORIES.includes(category)) {
      console.warn(`AI returned invalid category "${category}", falling back`);
      return keywordFallback(text);
    }

    // Double-check: if AI said "freedom", re-ask with a challenge
    if (category === 'freedom') {
      try {
        const check = await client.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 20,
          temperature: 0,
          messages: [
            { role: 'system', content: `A wish was classified as "freedom" (financial independence). But "freedom" is overused. Is there a MORE SPECIFIC category that fits better?\n\nCategories: house (places to live, flats, apartments), family (relatives, loved ones, connections), business (teams, products, companies, studios, ateliers), charity (causes, helping others, making world better, NGOs), art (creative projects), invest (wealth building).\n\nIf "freedom" is truly the best fit (early retirement, earning money, debt-free, quitting job), reply: freedom\nOtherwise reply with the better category key. ONLY the key.` },
            { role: 'user', content: `The wish is: "${text}"` }
          ]
        });
        const revised = check.choices[0].message.content.trim().toLowerCase();
        if (VALID_CATEGORIES.includes(revised) && revised !== category) {
          console.log(`Reclassified "${text}": ${category} -> ${revised}`);
          category = revised;
        }
      } catch(e) { /* keep original */ }
    }

    return category;
  } catch (err) {
    console.error('AI classification failed, using fallback:', err.message);
    return keywordFallback(text);
  }
}

function keywordFallback(text) {
  const lower = text.toLowerCase();
  const keywords = {
    house: ['house','home','apartment','property','villa','mansion','condo'],
    travel: ['travel','trip','world','vacation','explore','visit','island'],
    family: ['family','kids','children','parents','wedding','marry','mom','dad','mother','father'],
    education: ['education','school','university','degree','learn','study','college'],
    business: ['business','company','startup','entrepreneur','store','shop'],
    car: ['car','vehicle','tesla','lambo','lamborghini','ferrari','motorcycle'],
    health: ['health','hospital','medical','cure','doctor','therapy','wellness'],
    charity: ['charity','donate','give back','help others','volunteer','nonprofit'],
    freedom: ['freedom','retire','quit job','financial','independent','debt free','passive income'],
    technology: ['tech','computer','software','app','code','programming','developer'],
    art: ['art','music','create','studio','film','write','book','paint','song'],
    invest: ['invest','stocks','portfolio','wealth','savings','trading'],
    nature: ['farm','land','garden','nature','animals','ranch','forest','ocean','beach'],
    sports: ['sport','gym','athlete','fitness','football','soccer','basketball','marathon'],
    food: ['restaurant','food','cafe','cook','bakery','chef','kitchen'],
    gaming: ['game','gaming','esport','stream','console','vr'],
    fashion: ['fashion','clothes','brand','jewelry','watch','luxury'],
    pet: ['dog','cat','pet','puppy','kitten','rescue','adopt'],
  };
  let best = null, bestLen = 0;
  for (const [key, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      if (lower.includes(kw) && kw.length > bestLen) { best = key; bestLen = kw.length; }
    }
  }
  return best || 'freedom';
}

// Get all wishes (aggregated)
app.get('/api/wishes', (req, res) => {
  const vid = req.query.vid;
  const ip = getIP(req);

  const rows = db.prepare(`
    SELECT category, text, COUNT(*) as count
    FROM wishes
    GROUP BY LOWER(TRIM(text))
    ORDER BY count DESC
  `).all();

  const resCounts = db.prepare(`
    SELECT LOWER(TRIM(wish_text)) as t, COUNT(*) as resonances
    FROM resonances GROUP BY LOWER(TRIM(wish_text))
  `).all();
  const resMap = Object.fromEntries(resCounts.map(r => [r.t, r.resonances]));
  rows.forEach(r => { r.resonances = resMap[r.text.toLowerCase().trim()] || 0; });

  if (vid) {
    // Match by visitor_id OR ip
    const myTexts = db.prepare(
      `SELECT LOWER(TRIM(text)) as t FROM wishes WHERE visitor_id = ? OR ip = ?`
    ).all(vid, ip).map(r => r.t);
    const mySet = new Set(myTexts);
    rows.forEach(r => { r.mine = mySet.has(r.text.toLowerCase().trim()); });

    const myRes = db.prepare(
      `SELECT LOWER(TRIM(wish_text)) as t FROM resonances WHERE visitor_id = ?`
    ).all(vid).map(r => r.t);
    const myResSet = new Set(myRes);
    rows.forEach(r => { r.resonated = myResSet.has(r.text.toLowerCase().trim()); });
  }

  res.json(rows);
});

// Submit a wish
app.post('/api/wishes', async (req, res) => {
  const { text, visitorId } = req.body;
  const ip = getIP(req);

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Wish text is required' });
  }

  if (text.trim().length > 120) {
    return res.status(400).json({ error: 'Wish must be under 120 characters' });
  }

  if (!visitorId) {
    return res.status(400).json({ error: 'Visitor ID is required' });
  }

  // Check both visitor_id AND IP — whichever has more wishes wins
  const countByVid = db.prepare('SELECT COUNT(*) as c FROM wishes WHERE visitor_id = ?').get(visitorId).c;
  const countByIP = db.prepare('SELECT COUNT(*) as c FROM wishes WHERE ip = ?').get(ip).c;
  const count = Math.max(countByVid, countByIP);

  if (count >= 3) {
    return res.status(429).json({ error: 'You have already submitted 3 wishes' });
  }

  const category = await detectCategory(text.trim());

  db.prepare('INSERT INTO wishes (text, category, visitor_id, ip) VALUES (?, ?, ?, ?)')
    .run(text.trim(), category, visitorId, ip);

  res.json({ success: true, category, remaining: 2 - count });
});

// Get wish count for visitor (check both vid and IP)
app.get('/api/my-wishes/:visitorId', (req, res) => {
  const ip = getIP(req);
  const countByVid = db.prepare('SELECT COUNT(*) as c FROM wishes WHERE visitor_id = ?').get(req.params.visitorId).c;
  const countByIP = db.prepare('SELECT COUNT(*) as c FROM wishes WHERE ip = ?').get(ip).c;
  const count = Math.max(countByVid, countByIP);
  res.json({ count, remaining: Math.max(0, 3 - count) });
});

// Resonate with a wish
app.post('/api/resonate', (req, res) => {
  const { text, visitorId } = req.body;
  if (!text || !visitorId) return res.status(400).json({ error: 'Missing fields' });

  try {
    db.prepare('INSERT OR IGNORE INTO resonances (wish_text, visitor_id) VALUES (?, ?)')
      .run(text.trim(), visitorId);
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM resonances WHERE LOWER(TRIM(wish_text)) = LOWER(TRIM(?))'
    ).get(text.trim()).c;
    res.json({ success: true, resonances: count });
  } catch(e) {
    res.json({ success: true, resonances: 0 });
  }
});

// Admin: reclassify all wishes with AI
app.post('/api/admin/reclassify', async (req, res) => {
  const rows = db.prepare('SELECT id, text FROM wishes').all();
  const results = [];
  for (const row of rows) {
    const newCat = await detectCategory(row.text);
    db.prepare('UPDATE wishes SET category = ? WHERE id = ?').run(newCat, row.id);
    results.push({ text: row.text, category: newCat });
  }
  res.json({ reclassified: results.length, results });
});

// Admin: seed a wish (bypasses IP/visitor limits)
app.post('/api/admin/seed', async (req, res) => {
  const { text, visitorId } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const vid = visitorId || ('seed-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  const category = await detectCategory(text.trim());
  db.prepare('INSERT INTO wishes (text, category, visitor_id, ip) VALUES (?, ?, ?, ?)')
    .run(text.trim(), category, vid, 'seed');
  res.json({ success: true, category, text: text.trim() });
});

// Admin: manually set category for a wish
app.post('/api/admin/fix-category', (req, res) => {
  const { text, category } = req.body;
  if (!text || !category) return res.status(400).json({ error: 'text and category required' });
  const result = db.prepare('UPDATE wishes SET category = ? WHERE LOWER(TRIM(text)) = LOWER(TRIM(?))').run(category, text);
  res.json({ updated: result.changes, text, category });
});

// Admin: wipe all data
app.delete('/api/admin/wipe-all', (req, res) => {
  const wishes = db.prepare('DELETE FROM wishes').run().changes;
  const resonances = db.prepare('DELETE FROM resonances').run().changes;
  res.json({ wiped: { wishes, resonances } });
});

app.listen(PORT, () => {
  console.log(`Crypto Wishes running at http://localhost:${PORT}`);
});
