const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Database setup
const db = new Database(path.join(__dirname, 'wishes.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS wishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Resonances table
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

// Valid category keys
const VALID_CATEGORIES = [
  'house', 'travel', 'family', 'education', 'business', 'car',
  'health', 'charity', 'freedom', 'technology', 'art', 'invest',
  'nature', 'sports', 'food', 'gaming', 'fashion', 'pet'
];

// AI-powered category detection via ChatGPT
async function detectCategory(text) {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 20,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a classifier. Given a person's wish/dream, reply with exactly ONE category key from this list:\n${VALID_CATEGORIES.join(', ')}\n\nCategory meanings:\n- house: home, property, real estate, building/buying a house\n- travel: traveling, exploring, vacations, visiting places\n- family: family, parents, kids, marriage, relationships\n- education: learning, school, degrees, courses, studying\n- business: starting a company, entrepreneurship, shops\n- car: vehicles, cars, motorcycles\n- health: medical, wellness, mental health, fitness goals\n- charity: giving back, donations, helping others, community\n- freedom: financial freedom, retiring early, quitting job, debt free, independence\n- technology: coding, software, gadgets, AI, tech projects\n- art: music, painting, writing, film, creative projects\n- invest: investing, stocks, crypto trading, building wealth\n- nature: farming, gardening, animals, outdoors, land\n- sports: athletics, gym, sports teams, marathons\n- food: restaurants, cooking, cafes, bakeries\n- gaming: video games, esports, game development, streaming\n- fashion: clothing, brands, jewelry, luxury, design\n- pet: dogs, cats, adopting pets, animal rescue\n\nReply with ONLY the category key, nothing else.`
        },
        {
          role: 'user',
          content: text
        }
      ]
    });

    const category = res.choices[0].message.content.trim().toLowerCase();
    if (VALID_CATEGORIES.includes(category)) {
      return category;
    }
    console.warn(`AI returned invalid category "${category}", falling back`);
    return keywordFallback(text);
  } catch (err) {
    console.error('AI classification failed, using fallback:', err.message);
    return keywordFallback(text);
  }
}

// Keyword fallback if AI is unavailable
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

// Get all wishes (aggregated) with resonance counts
app.get('/api/wishes', (req, res) => {
  const vid = req.query.vid;
  const rows = db.prepare(`
    SELECT category, text, COUNT(*) as count
    FROM wishes
    GROUP BY LOWER(TRIM(text))
    ORDER BY count DESC
  `).all();

  // Attach resonance counts
  const resCounts = db.prepare(`
    SELECT LOWER(TRIM(wish_text)) as t, COUNT(*) as resonances
    FROM resonances GROUP BY LOWER(TRIM(wish_text))
  `).all();
  const resMap = Object.fromEntries(resCounts.map(r => [r.t, r.resonances]));

  rows.forEach(r => {
    r.resonances = resMap[r.text.toLowerCase().trim()] || 0;
  });

  if (vid) {
    const myTexts = db.prepare(
      `SELECT LOWER(TRIM(text)) as t FROM wishes WHERE visitor_id = ?`
    ).all(vid).map(r => r.t);
    const mySet = new Set(myTexts);
    rows.forEach(r => { r.mine = mySet.has(r.text.toLowerCase().trim()); });

    // Mark which wishes this visitor has resonated with
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

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Wish text is required' });
  }

  if (text.trim().length > 120) {
    return res.status(400).json({ error: 'Wish must be under 120 characters' });
  }

  if (!visitorId) {
    return res.status(400).json({ error: 'Visitor ID is required' });
  }

  const count = db.prepare('SELECT COUNT(*) as c FROM wishes WHERE visitor_id = ?').get(visitorId).c;
  if (count >= 3) {
    return res.status(429).json({ error: 'You have already submitted 3 wishes' });
  }

  const category = await detectCategory(text.trim());

  db.prepare('INSERT INTO wishes (text, category, visitor_id) VALUES (?, ?, ?)')
    .run(text.trim(), category, visitorId);

  res.json({ success: true, category, remaining: 2 - count });
});

// Get wish count for visitor
app.get('/api/my-wishes/:visitorId', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM wishes WHERE visitor_id = ?').get(req.params.visitorId).c;
  res.json({ count, remaining: Math.max(0, 3 - count) });
});

// Resonate with a wish
app.post('/api/resonate', (req, res) => {
  const { text, visitorId } = req.body;

  if (!text || !visitorId) {
    return res.status(400).json({ error: 'Missing fields' });
  }

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

app.listen(PORT, () => {
  console.log(`Crypto Wishes running at http://localhost:${PORT}`);
});
