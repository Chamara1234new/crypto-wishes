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

// Database setup
const db = new Database(path.join(__dirname, 'wishes.db'));
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
      model: 'gpt-4o-mini',
      max_tokens: 20,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You classify people's wishes/dreams into categories. Reply with exactly ONE category key from this list:\n${VALID_CATEGORIES.join(', ')}\n\nCategory meanings:\n- house: home, apartment, flat, property, real estate, building/buying a house or flat, having a nice place to live\n- travel: traveling, exploring, seeing the world, vacations, visiting places\n- family: family, parents, kids, marriage, relationships, doing things for relatives\n- education: learning, school, degrees, courses, studying\n- business: starting a company, entrepreneurship, shops, building a team, growing a product, getting users, studios, ateliers\n- car: vehicles, cars, motorcycles\n- health: medical, wellness, mental health, fitness goals\n- charity: giving back, donations, helping others, community, raising money for causes, nonprofits, NGOs\n- freedom: ONLY for financial freedom, retiring early, quitting job, debt free, independence, earning a specific amount of money. Do NOT use this as a catch-all.\n- technology: coding, software, gadgets, AI, tech projects\n- art: music, painting, writing, film, creative projects, design studios\n- invest: investing, stocks, crypto trading, building generational wealth\n- nature: farming, gardening, animals, outdoors, land\n- sports: athletics, gym, sports teams, marathons\n- food: restaurants, cooking, cafes, bakeries\n- gaming: video games, esports, game development, streaming\n- fashion: clothing, brands, jewelry, luxury, style\n- pet: dogs, cats, adopting pets, animal rescue\n\nIMPORTANT: "freedom" is ONLY for financial independence wishes. If the wish is about a place to live (flat, apartment, house), use "house". If it's about a business/product/team, use "business". If it's about raising money for a cause, use "charity". When in doubt, pick the most specific category, NOT freedom.\n\nReply with ONLY the category key, nothing else.`
        },
        { role: 'user', content: text }
      ]
    });

    const category = res.choices[0].message.content.trim().toLowerCase();
    if (VALID_CATEGORIES.includes(category)) return category;
    console.warn(`AI returned invalid category "${category}", falling back`);
    return keywordFallback(text);
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

// Admin: wipe all data
app.delete('/api/admin/wipe-all', (req, res) => {
  const wishes = db.prepare('DELETE FROM wishes').run().changes;
  const resonances = db.prepare('DELETE FROM resonances').run().changes;
  res.json({ wiped: { wishes, resonances } });
});

app.listen(PORT, () => {
  console.log(`Crypto Wishes running at http://localhost:${PORT}`);
});
