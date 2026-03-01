require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Mistral } = require('@mistralai/mistralai');
const WebSocket = require('ws');

const app = express();
app.use(cors({ origin: 'http://localhost:1234' }));
app.use(express.json());

const VALID_TROOPS = [
  'AlienTroop', 'BattleOtterTroop', 'ChickphinTroop', 'ClownGuyTroop',
  'ClownLadyTroop', 'EvilTroop', 'LilDemonTroop', 'MamaCowTroop',
  'QuackerTroop', 'TankTroop', 'VolcanoTroop', 'WitchTroop', 'ZDogTroop'
];
const VALID_LANES = ['left', 'right'];

if (!process.env.MISTRAL_API_KEY) {
  console.error('MISTRAL_API_KEY is not set. The /api/strategy endpoint will return 500.');
}

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY || '' });

const STRATEGY_SYSTEM_PROMPT = `You are a Clan Royale strategy AI. Given game state and a player's voice command, decide which cards to play and where.

CARD REFERENCE (name | cost | HP | dmg | speed | atkRate | atkRange | units | role):
  TankTroop       | 6 | 200 | 200 | 5  | 3.0s  | 50 | 1 | TANK — Slowest but hardest-hitting. Best meatshield in the game.
  ChickphinTroop  | 6 | 200 |  50 | 8  | 1.5s  | 20 | 1 | TANK — Sturdy, medium speed, lower damage.
  EvilTroop       | 5 | 200 |  20 | 10 | 1.5s  | 20 | 1 | TANK — Widest aggro range (50), pulls enemies away.
  WitchTroop      | 4 |  50 | 100 | 10 | 2.0s  | 40 | 1 | SPAWNER — Spawns MagicPuppies every 3s. Place behind a tank.
  MamaCowTroop    | 4 |  50 | 100 | 10 | 2.0s  | 40 | 1 | SPAWNER — Spawns BabyCows every 3s. Place behind a tank.
  VolcanoTroop    | 4 |  50 | 100 |  0 |  N/A  |  0 | 1 | BUILDING — Immovable, AoE damage interval, spawns Dinos. Area denial.
  QuackerTroop    | 3 |  50 |   5 | 10 | 0.2s  | 20 | 3 | FLYING SWARM — 3 flyers, very fast attack (5 hits/sec). Bypasses ground.
  ZDogTroop       | 3 |  40 |  20 | 10 | 1.5s  | 20 | 5 | GROUND SWARM — 5 units, overwhelms single-target troops.
  AlienTroop      | 3 |  10 |  10 | 17 | 1.0s  | 20 | 5 | GROUND SWARM — 5 fragile but fast bodies to distract.
  BattleOtterTroop| 3 |  50 |  20 | 15 | 1.0s  | 30 | 1 | FIGHTER — Solid all-rounder, fast with decent range.
  LilDemonTroop   | 2 |  50 |  10 | 20 | 0.5s  | 20 | 2 | SWARM — 2 very fast attackers (2 hits/sec each). Cheapest multi-unit.
  ClownGuyTroop   | 1 |  10 |  10 | 17 | 1.0s  | 20 | 1 | CYCLE — Ultra-cheap; cycle hand or distract.
  ClownLadyTroop  | 1 |  10 |  10 | 17 | 1.0s  | 20 | 1 | CYCLE — Ultra-cheap; cycle hand or distract.

STRATEGY GUIDELINES:
  - PUSH combo: Tank in front (TankTroop/EvilTroop/ChickphinTroop) + spawner behind (WitchTroop/MamaCowTroop). This is the strongest pattern.
  - COUNTER SWARM: Use VolcanoTroop (AoE) or your own swarm to trade efficiently.
  - BYPASS GROUND: QuackerTroop flies over ground-only defenders — great for surprise damage.
  - DISTRACT: Cheap units (ClownGuyTroop, ClownLadyTroop, LilDemonTroop) absorb hits from heavy troops.
  - SPLIT PRESSURE: Deploy in opposite lane from opponent's push to force them to split defense.
  - COUNTER-PUSH: After defending, use surviving troops + add support behind them instead of fresh push.

COUNTER-MATCHUPS (use these to make smart trades):
  - QuackerTroop BEATS any ground-only push — flies over, can't be hit by melee walkers.
  - VolcanoTroop BEATS swarms — AoE damage interval kills clustered low-HP units like AlienTroop/ZDogTroop.
  - ZDogTroop/AlienTroop BEATS single-target tanks — 5 bodies overwhelm 1 slow attacker (TankTroop hits one, 4 keep hitting).
  - TankTroop BEATS spawners — 200 HP absorbs all spawner damage while tower kills the spawner.
  - WitchTroop behind TankTroop = infinite value combo — MagicPuppies pile up behind the meatshield.
  - LilDemonTroop COUNTERS expensive single units — cheap 2-mana trade, cycles hand fast (0.5s attack rate).
  - ClownGuyTroop/ClownLadyTroop best for pulling aggro away from tower — 1-mana distraction buys time.
  - BattleOtterTroop is the best lone-defender — 50 HP, fast, decent range (30), good DPS at 1.0s rate.
  - Against QuackerTroop: only ranged/flying troops or towers can hit them — don't waste melee units.

MANA RULES:
  - NEVER spend more mana than available. Total cost of all actions must be <= current mana.
  - Keep 2-3 mana in reserve for counter-play unless going all-in.
  - At 10 mana you're wasting mana — always spend some.
  - Cheaper cards cycle your hand faster to get back to key cards.

LANE DECISION:
  - If opponent pushes LEFT → either defend LEFT with counter-troops OR punish RIGHT with all-in.
  - If opponent pushes RIGHT → same logic, mirror side.
  - If no threat → build a push in the lane where opponent's tower has less health.
  - Check opponentTowers x positions: x<=50 is left tower, x>=110 is right tower, middle is center.

URGENCY MAPPING:
  - "low": No immediate threat. Save mana, maybe play 0-1 cheap cards.
  - "medium": Some pressure. Deploy 1-2 cards to address it.
  - "high": Tower under heavy attack or strong push opportunity. Commit 3+ cards.

RESPONSE FORMAT — return ONLY valid JSON:
{"actions": [{"type": "play_card", "card": "<exact card name from hand>", "lane": "left|right"}], "reasoning": "<1-2 sentences>", "urgency": "low|medium|high"}

CRITICAL:
  - The "card" field MUST exactly match a "name" from the hand array in the game state (e.g. "TankTroop", "WitchTroop").
  - Only play cards that appear in the hand array.
  - If the best move is to wait, return {"actions": [], "reasoning": "...", "urgency": "low"}.`;

function validateStrategyResponse(data, gameState) {
  if (!data || typeof data !== 'object') return 'Response is not a JSON object';
  if (!Array.isArray(data.actions)) return 'Missing or invalid "actions" array';
  if (typeof data.reasoning !== 'string') return 'Missing or invalid "reasoning" string';

  const handNames = gameState && gameState.hand
    ? gameState.hand.map(c => c.name)
    : null;
  const handCostMap = gameState && gameState.hand
    ? Object.fromEntries(gameState.hand.map(c => [c.name, c.cost]))
    : {};
  const availableMana = gameState ? gameState.mana : Infinity;
  let totalCost = 0;

  for (let i = 0; i < data.actions.length; i++) {
    const action = data.actions[i];
    if (action.type !== 'play_card') return `actions[${i}].type must be "play_card"`;
    if (!VALID_TROOPS.includes(action.card)) return `actions[${i}].card "${action.card}" is not a valid troop`;
    if (!VALID_LANES.includes(action.lane)) return `actions[${i}].lane "${action.lane}" must be "left" or "right"`;
    if (handNames && !handNames.includes(action.card)) return `actions[${i}].card "${action.card}" is not in hand`;
    totalCost += handCostMap[action.card] || 0;
  }

  if (totalCost > availableMana) return `Total cost ${totalCost} exceeds available mana ${availableMana}`;
  return null;
}

function buildFallbackResponse(gameState) {
  if (!gameState || !gameState.hand || gameState.hand.length === 0) {
    return { actions: [], reasoning: 'No cards in hand, waiting.', urgency: 'low' };
  }
  const affordable = gameState.hand
    .filter(c => c.cost <= gameState.mana)
    .sort((a, b) => a.cost - b.cost);
  if (affordable.length === 0) {
    return { actions: [], reasoning: 'Not enough mana for any card, waiting.', urgency: 'low' };
  }
  const cheapest = affordable[0];
  return {
    actions: [{ type: 'play_card', card: cheapest.name, lane: 'left' }],
    reasoning: `Fallback: playing cheapest affordable card (${cheapest.name}).`,
    urgency: 'medium'
  };
}

const RETRY_SYSTEM_PROMPT = `You are a Clan Royale strategy AI. Return ONLY valid JSON.
CARDS IN HAND are listed below. Use EXACT card names. Lane must be "left" or "right". Total cost must not exceed mana.
Format: {"actions": [{"type": "play_card", "card": "<name>", "lane": "left|right"}], "reasoning": "...", "urgency": "low|medium|high"}
If unsure, return {"actions": [], "reasoning": "waiting", "urgency": "low"}.`;

async function callMistral(systemPrompt, gameState, playerCommand) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const result = await mistral.chat.complete({
      model: 'mistral-small-latest',
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ gameState, playerCommand }) }
      ]
    }, { fetchOptions: { signal: controller.signal } });
    return JSON.parse(result.choices[0].message.content);
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/config', (req, res) => {
  res.json({ agentId: process.env.ELEVENLABS_AGENT_ID || null });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mistralKeySet: !!process.env.MISTRAL_API_KEY,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/conversation-token', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.ELEVENLABS_AGENT_ID}`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Request body must include "text".' });
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.2 }
      })
    });

    if (!ttsRes.ok) {
      console.error(`ElevenLabs TTS error: ${ttsRes.status} ${ttsRes.statusText}`);
      return res.status(500).json({ error: 'TTS failed' });
    }

    res.set('Content-Type', 'audio/mpeg');
    const reader = ttsRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };
    await pump();
  } catch (err) {
    console.error('TTS proxy error:', err.message);
    res.status(500).json({ error: 'TTS failed' });
  }
});

app.get('/api/deepgram-key', (req, res) => {
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: 'DEEPGRAM_API_KEY not configured' });
  }
  res.json({ key: process.env.DEEPGRAM_API_KEY });
});

app.post('/api/strategy', async (req, res) => {
  if (!process.env.MISTRAL_API_KEY) {
    return res.status(500).json({ error: 'MISTRAL_API_KEY is not configured on the server.' });
  }

  const { gameState, playerCommand } = req.body;
  if (!gameState || !playerCommand) {
    return res.status(400).json({ error: 'Request body must include "gameState" and "playerCommand".' });
  }

  const ts = new Date().toISOString();
  console.log(`[${ts}] /api/strategy command="${playerCommand}"`);

  let data;
  let validationError;

  try {
    data = await callMistral(STRATEGY_SYSTEM_PROMPT, gameState, playerCommand);
    validationError = validateStrategyResponse(data, gameState);

    // Retry once with simplified prompt if Mistral returned invalid structure
    if (validationError) {
      console.log(`[${ts}] Invalid response (${validationError}), retrying with simplified prompt...`);
      data = await callMistral(RETRY_SYSTEM_PROMPT, gameState, playerCommand);
      validationError = validateStrategyResponse(data, gameState);
    }
  } catch (err) {
    const errMsg = err.name === 'AbortError' ? 'Mistral API request timed out (10s)' : err.message;
    console.error(`[${ts}] Mistral API error: ${errMsg} — using fallback`);
    data = buildFallbackResponse(gameState);
    console.log(`[${ts}] Fallback: ${data.actions.length} action(s), reasoning="${data.reasoning}"`);
    return res.json(data);
  }

  // If still invalid after retry, use fallback instead of returning an error
  if (validationError) {
    console.error(`[${ts}] Validation failed after retry: ${validationError} — using fallback`);
    data = buildFallbackResponse(gameState);
  }

  console.log(`[${ts}] Response: ${data.actions.length} action(s), reasoning="${data.reasoning}"`);
  res.json(data);
});

const server = app.listen(3001, () => console.log('Server running on http://localhost:3001'));

// WebSocket proxy for Deepgram STT — browser connects here, server relays to Deepgram with auth header
const wss = new WebSocket.Server({ server, path: '/deepgram' });

wss.on('connection', (clientWs) => {
  const dgKey = process.env.DEEPGRAM_API_KEY;
  if (!dgKey) {
    clientWs.close(4001, 'DEEPGRAM_API_KEY not configured');
    return;
  }

  const dgUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&endpointing=200&vad_events=true';
  const dgWs = new WebSocket(dgUrl, { headers: { Authorization: 'Token ' + dgKey } });

  dgWs.on('open', () => {
    console.log('[Deepgram] Proxy connected');
  });

  // Relay Deepgram transcription results back to browser
  dgWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  // Relay audio chunks from browser to Deepgram
  clientWs.on('message', (data) => {
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.send(data);
    }
  });

  clientWs.on('close', () => {
    dgWs.close();
  });

  dgWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  dgWs.on('error', (err) => {
    console.error('[Deepgram] WebSocket error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4002, 'Deepgram connection failed');
    }
  });
});
