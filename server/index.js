require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Mistral } = require('@mistralai/mistralai');
const OpenAI = require('openai');
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
const grok = new OpenAI({ apiKey: process.env.XAI_API_KEY || '', baseURL: 'https://api.x.ai/v1' });

// W&B Qwen models (base + fine-tuned SFT on gameplay data)
const wandb = process.env.WANDB_API_KEY
  ? new OpenAI({ apiKey: process.env.WANDB_API_KEY, baseURL: 'https://api.training.wandb.ai/v1/' })
  : null;
const WANDB_FT_MODEL_ID = 'wandb-artifact:///philbog/clan-royale/clan-royale-sft';
const WANDB_BASE_MODEL_ID = 'wandb-artifact:///philbog/clan-royale/clan-royale-base';

async function callQwen(gameState, command, modelId) {
  if (!wandb) throw new Error('WANDB_API_KEY not configured');
  const response = await wandb.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: STRATEGY_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ gameState, playerCommand: command }) }
    ],
    max_tokens: 300
  });
  const content = response.choices[0].message.content;
  // Strip markdown fences and /think tags if present
  let cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const parsed = JSON.parse(cleaned);
  // Handle both formats: full object {actions, reasoning} or bare array
  if (Array.isArray(parsed)) {
    return { actions: parsed, reasoning: 'Deploying troops!', urgency: 'medium' };
  }
  return {
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    reasoning: parsed.reasoning || 'Deploying troops!',
    urgency: parsed.urgency || 'medium'
  };
}

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
  - Cards that cost more than current mana will be QUEUED and auto-deploy when mana fills. So you CAN play expensive cards even with low mana.
  - Prefer playing cards you can afford now, but queue expensive cards if they're strategically important.
  - At 10 mana you're wasting mana — always spend some.
  - Cheaper cards cycle your hand faster to get back to key cards.

DEPLOYMENT GRID:
  Your half of the battlefield is a 10×6 grid.
  - Columns (col): 0-9, left to right. Col 0-4 = left side, col 5-9 = right side.
  - Rows (row): 0-5, top to bottom.

BATTLEFIELD MAP:
  Row 0:   River edge. LEFT BRIDGE at col 1-2, RIGHT BRIDGE at col 7-8. Troops cross here to attack.
  Row 1:   Front line. Aggressive — troops reach enemy quickly via bridges.
  Row 2-3: Mid field. Best intercept zone for tanks and defenders.
  Row 4-5: Back line near YOUR towers. Safe for spawners and ranged support.
  Your towers: left tower at col 1-2, king tower at col 4-5, right tower at col 8.

  All troop positions in the game state use grid coordinates (col, row) — use these directly.

PLACEMENT RULES — READ CAREFULLY:
  1. TANKS pushing: row 0-1 near a bridge. Left push = col 1-2. Right push = col 7-8.
  2. TANKS defending: row 2-3 in the SAME COLUMN as the enemy troop you're countering.
  3. SPAWNERS: ALWAYS row 4-5 (behind tanks). Col depends on which side needs support.
  4. BUILDINGS (VolcanoTroop): row 3-4, col 4-5 (center) to pull aggro from both lanes.
  5. SWARM offense: row 0-1, near the bridge on the side you're attacking.
  6. SWARM defense: same col as the enemy threat, row 2-3 to intercept.
  7. FIGHTERS: row 1-3, same column range as the biggest enemy.
  8. CYCLE cards: distract at row 2-3 in the enemy's column, or row 0-1 for opposite-lane pressure.

  CRITICAL — VARY YOUR PLACEMENTS:
  - Look at opponentTroops positions. Deploy defenders in the SAME column range as enemies.
  - If enemy pushes left (col 0-4), defend on the left (col 0-4). If right (col 5-9), defend right.
  - For split pressure, deploy in the OPPOSITE column range from where enemies are.
  - Use BOTH bridges — don't always push through the same one.
  - Spawners and support behind the tank, in the same column (e.g., tank at col 2 row 1, spawner at col 2 row 4).

URGENCY MAPPING:
  - "low": No immediate threat. Save mana, maybe play 0-1 cheap cards.
  - "medium": Some pressure. Deploy 1-2 cards to address it.
  - "high": Tower under heavy attack or strong push opportunity. Commit 3+ cards.

RESPONSE FORMAT — return ONLY valid JSON:
{"actions": [{"type": "play_card", "card": "<exact card name from hand>", "col": <0-9>, "row": <0-5>}], "reasoning": "<1-2 sentences>", "urgency": "low|medium|high"}

CRITICAL:
  - The "card" field MUST exactly match a "name" from the hand array in the game state.
  - "col" must be an integer 0-9. "row" must be an integer 0-5.
  - Only play cards that appear in the hand array.
  - If the best move is to wait, return {"actions": [], "reasoning": "...", "urgency": "low"}.`;

function validateStrategyResponse(data, gameState) {
  if (!data || typeof data !== 'object') return 'Response is not a JSON object';
  if (!Array.isArray(data.actions)) return 'Missing or invalid "actions" array';
  if (typeof data.reasoning !== 'string') return 'Missing or invalid "reasoning" string';

  const handNames = gameState && gameState.hand
    ? gameState.hand.map(c => c.name)
    : null;
  for (let i = 0; i < data.actions.length; i++) {
    const action = data.actions[i];
    if (action.type !== 'play_card') return `actions[${i}].type must be "play_card"`;
    if (!VALID_TROOPS.includes(action.card)) return `actions[${i}].card "${action.card}" is not a valid troop`;
    // Accept either col/row (preferred) or lane (legacy)
    if (action.col != null || action.row != null) {
      if (!Number.isInteger(action.col) || action.col < 0 || action.col > 9)
        return `actions[${i}].col must be integer 0-9`;
      if (!Number.isInteger(action.row) || action.row < 0 || action.row > 5)
        return `actions[${i}].row must be integer 0-5`;
    } else if (!VALID_LANES.includes(action.lane)) {
      return `actions[${i}] must have col/row or valid lane`;
    }
    // Mana check removed — client-side queue handles insufficient mana
  }

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
    actions: [{ type: 'play_card', card: cheapest.name, col: 2, row: 4 }],
    reasoning: `Fallback: playing cheapest affordable card (${cheapest.name}).`,
    urgency: 'medium'
  };
}

const RETRY_SYSTEM_PROMPT = `You are a Clan Royale strategy AI. Return ONLY valid JSON.
CARDS IN HAND are listed below. Use EXACT card names. col must be 0-9, row must be 0-5. Total cost must not exceed mana.
Format: {"actions": [{"type": "play_card", "card": "<name>", "col": <0-9>, "row": <0-5>}], "reasoning": "...", "urgency": "low|medium|high"}
If unsure, return {"actions": [], "reasoning": "waiting", "urgency": "low"}.`;

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the strategic commander for Clan Royale, a tower-defense card game.

BATTLEFIELD LAYOUT:
- 10x6 grid (col 0-9, row 0-5). Each player has their own half.
- Bridges at col 1-2 (left) and col 7-8 (right) on row 0. Troops must cross bridges to reach the enemy.
- Tower positions: left tower at col 1-2, king tower at col 4-5, right tower at col 8.

YOUR JOB:
Analyze the current game state and produce a high-level strategic command. Consider:
1. Tower health (yours and opponent's) — which towers are weak or destroyed?
2. Enemy troop positions — where is the threat? Which lane?
3. Current mana — can we afford a big push or should we defend cheaply?
4. Cards in hand — what synergies are available? (Tank + Spawner combo, swarm counter, etc.)
5. Existing friendly troops — can we support a surviving push instead of starting fresh?

OUTPUT FORMAT — return ONLY valid JSON:
{"strategy": "<a specific tactical command, e.g. 'Push right lane with tank + spawner combo' or 'Defend left with swarm, counter-push right'>", "reasoning": "<2-3 sentences explaining why>"}

Be concrete and specific. Name the cards you recommend. Reference lanes (left/right) and positions.`;

async function callMistral(systemPrompt, gameState, playerCommand, modelOverride) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const model = modelOverride || 'mistral-small-latest';
    const result = await mistral.chat.complete({
      model,
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
  const { gameState, playerCommand, connectorModel } = req.body;
  if (!gameState || !playerCommand) {
    return res.status(400).json({ error: 'Request body must include "gameState" and "playerCommand".' });
  }

  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ═══ /api/strategy ═══`);
  console.log(`  connector: ${connectorModel || 'mistral (default)'}`);
  console.log(`  command: "${playerCommand}"`);
  console.log(`  mana: ${gameState.mana}, hand: [${(gameState.hand || []).map(c => c.name + '(' + c.cost + ')').join(', ')}]`);
  console.log(`  myTroops: ${JSON.stringify(gameState.myTroops)}`);
  console.log(`  opponentTroops: ${JSON.stringify(gameState.opponentTroops)}`);
  console.log(`  myTowers: ${JSON.stringify(gameState.myTowers)}`);
  console.log(`  opponentTowers: ${JSON.stringify(gameState.opponentTowers)}`);

  let data;
  let validationError;

  // Route to Qwen models (base or fine-tuned) when requested
  if (connectorModel === 'qwen-base' || connectorModel === 'qwen-finetuned') {
    const modelId = connectorModel === 'qwen-finetuned' ? WANDB_FT_MODEL_ID : WANDB_BASE_MODEL_ID;
    console.log(`  Using Qwen: ${modelId}`);
    try {
      data = await callQwen(gameState, playerCommand, modelId);
      console.log(`  [Qwen] raw: ${JSON.stringify(data)}`);
      validationError = validateStrategyResponse(data, gameState);
      if (validationError) {
        console.log(`  [Qwen] validation error: ${validationError} — using fallback`);
        data = buildFallbackResponse(gameState);
      }
    } catch (err) {
      console.error(`  [Qwen] Error: ${err.message} — using FALLBACK`);
      data = buildFallbackResponse(gameState);
    }
  } else {
    // Default: Mistral connector
    if (!process.env.MISTRAL_API_KEY) {
      return res.status(500).json({ error: 'MISTRAL_API_KEY is not configured on the server.' });
    }
    try {
      data = await callMistral(STRATEGY_SYSTEM_PROMPT, gameState, playerCommand);
      console.log(`  Mistral raw response: ${JSON.stringify(data)}`);
      validationError = validateStrategyResponse(data, gameState);
      if (validationError) console.log(`  Validation error: ${validationError}`);

      if (validationError) {
        console.log(`  Retrying with simplified prompt...`);
        data = await callMistral(RETRY_SYSTEM_PROMPT, gameState, playerCommand);
        console.log(`  Retry response: ${JSON.stringify(data)}`);
        validationError = validateStrategyResponse(data, gameState);
        if (validationError) console.log(`  Retry validation error: ${validationError}`);
      }
    } catch (err) {
      const errMsg = err.name === 'AbortError' ? 'Mistral API request timed out (10s)' : err.message;
      console.error(`  Mistral API error: ${errMsg} — using FALLBACK`);
      data = buildFallbackResponse(gameState);
      console.log(`  Fallback → ${JSON.stringify(data.actions)}`);
      return res.json(data);
    }

    if (validationError) {
      console.error(`  Validation failed after retry: ${validationError} — using FALLBACK`);
      data = buildFallbackResponse(gameState);
    }
  }

  console.log(`  ✓ FINAL: ${data.actions.length} action(s): ${JSON.stringify(data.actions)}`);
  console.log(`  reasoning: "${data.reasoning}"`);
  res.json(data);
});

// ─── /api/ai-turn — Orchestrator (Grok) + Connector (Mistral) pipeline ───
app.post('/api/ai-turn', async (req, res) => {
  const { gameState, modelType, side } = req.body;
  if (!gameState) {
    return res.status(400).json({ error: 'Request body must include "gameState".' });
  }

  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ═══ /api/ai-turn ═══`);
  console.log(`  modelType: ${modelType || 'base'}, side: ${side || 'player'}`);
  console.log(`  mana: ${gameState.mana}, hand: [${(gameState.hand || []).map(c => c.name + '(' + c.cost + ')').join(', ')}]`);
  console.log(`  myTroops: ${JSON.stringify(gameState.myTroops)}`);
  console.log(`  opponentTroops: ${JSON.stringify(gameState.opponentTroops)}`);
  console.log(`  myTowers: ${JSON.stringify(gameState.myTowers)}`);
  console.log(`  opponentTowers: ${JSON.stringify(gameState.opponentTowers)}`);

  // Step 1: Call Grok orchestrator for high-level strategy
  let orchestratorResult;
  const orchStart = Date.now();
  try {
    if (!process.env.XAI_API_KEY) {
      throw new Error('XAI_API_KEY not configured');
    }
    const orchResponse = await grok.chat.completions.create({
      model: 'grok-4-1-fast-non-reasoning',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ gameState }) }
      ]
    });
    orchestratorResult = JSON.parse(orchResponse.choices[0].message.content);
    console.log(`  [Orchestrator] strategy: "${orchestratorResult.strategy}"`);
    console.log(`  [Orchestrator] reasoning: "${orchestratorResult.reasoning}"`);
  } catch (err) {
    console.error(`  [Orchestrator] Error: ${err.message} — using fallback strategy`);
    orchestratorResult = {
      strategy: 'Play your cheapest available card defensively',
      reasoning: 'Orchestrator unavailable, defaulting to conservative play.'
    };
  }
  const orchLatency = Date.now() - orchStart;
  console.log(`  [Orchestrator] latency: ${orchLatency}ms`);

  // Step 2: Call connector — W&B fine-tuned or Mistral base
  const useFinetuned = modelType === 'finetuned' && wandb;
  const connectorModelLabel = useFinetuned ? `wandb:${WANDB_FT_MODEL_ID}` : 'mistral-small-latest';

  let connectorResult;
  let connectorValidationError;
  const connStart = Date.now();

  if (useFinetuned) {
    // Call W&B fine-tuned Qwen model (trained on gameplay data)
    try {
      const userMsg = `State:${JSON.stringify(gameState)}\nCmd:"${orchestratorResult.strategy}"`;
      const ftResponse = await wandb.chat.completions.create({
        model: WANDB_FT_MODEL_ID,
        messages: [
          { role: 'system', content: FINETUNED_SYSTEM_PROMPT },
          { role: 'user', content: userMsg }
        ],
        max_tokens: 200
      });
      const content = ftResponse.choices[0].message.content;
      console.log(`  [Connector/FT] raw: ${content}`);
      const actions = JSON.parse(content);
      connectorResult = {
        actions: Array.isArray(actions) ? actions : [],
        reasoning: 'Fine-tuned model decision',
        urgency: 'medium'
      };
      connectorValidationError = validateStrategyResponse(connectorResult, gameState);
    } catch (err) {
      console.error(`  [Connector/FT] Error: ${err.message} — using fallback`);
      connectorResult = buildFallbackResponse(gameState);
      connectorValidationError = null;
    }
  } else {
    // Call Mistral base connector
    try {
      if (!process.env.MISTRAL_API_KEY) {
        throw new Error('MISTRAL_API_KEY not configured');
      }
      connectorResult = await callMistral(STRATEGY_SYSTEM_PROMPT, gameState, orchestratorResult.strategy);
      console.log(`  [Connector] raw: ${JSON.stringify(connectorResult)}`);
      connectorValidationError = validateStrategyResponse(connectorResult, gameState);

      if (connectorValidationError) {
        console.log(`  [Connector] validation error: ${connectorValidationError}, retrying...`);
        connectorResult = await callMistral(RETRY_SYSTEM_PROMPT, gameState, orchestratorResult.strategy);
        connectorValidationError = validateStrategyResponse(connectorResult, gameState);
      }
    } catch (err) {
      const errMsg = err.name === 'AbortError' ? 'Mistral API request timed out (10s)' : err.message;
      console.error(`  [Connector] Error: ${errMsg} — using fallback`);
      connectorResult = buildFallbackResponse(gameState);
      connectorValidationError = null;
    }
  }

  if (connectorValidationError) {
    console.error(`  [Connector] Validation failed: ${connectorValidationError} — using fallback`);
    connectorResult = buildFallbackResponse(gameState);
  }
  const connLatency = Date.now() - connStart;
  console.log(`  [Connector] model: ${connectorModelLabel}, latency: ${connLatency}ms`);
  console.log(`  [Connector] actions: ${JSON.stringify(connectorResult.actions)}`);

  const response = {
    orchestrator: {
      model: 'grok-4-1-fast-non-reasoning',
      reasoning: orchestratorResult.reasoning,
      strategy: orchestratorResult.strategy,
      latencyMs: orchLatency
    },
    connector: {
      model: connectorModelLabel,
      actions: connectorResult.actions,
      reasoning: connectorResult.reasoning,
      urgency: connectorResult.urgency,
      latencyMs: connLatency
    }
  };

  console.log(`  ═══ /api/ai-turn complete (total ${orchLatency + connLatency}ms) ═══\n`);
  res.json(response);
});

// ─── /api/record-gameplay — Append gameplay entries as JSONL ───
app.post('/api/record-gameplay', (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Request body must include a non-empty "entries" array.' });
  }

  const filePath = path.join(__dirname, '..', 'evaluation', 'recorded-gameplay.jsonl');

  // Ensure evaluation directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  fs.appendFileSync(filePath, lines);

  console.log(`[record-gameplay] Appended ${entries.length} entries to ${filePath}`);
  res.json({ success: true, count: entries.length });
});

const server = app.listen(3001, () => console.log('Server running on http://localhost:3001'));

// WebSocket proxy for Deepgram STT — browser connects here, server relays to Deepgram with auth header
const wss = new WebSocket.Server({
  server,
  verifyClient: (info) => info.req.url.startsWith('/deepgram')
});

wss.on('connection', (clientWs, req) => {
  const dgKey = process.env.DEEPGRAM_API_KEY;
  if (!dgKey) {
    clientWs.close(4001, 'DEEPGRAM_API_KEY not configured');
    return;
  }

  // Check if client sent encoding hint (Safari sends aac in mp4 container)
  const url = new URL(req.url, 'http://localhost');
  const encoding = url.searchParams.get('encoding');
  let dgUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&endpointing=200&vad_events=true';
  if (encoding === 'aac') {
    dgUrl += '&encoding=aac&sample_rate=48000';
  }
  console.log(`[Deepgram] Connecting with encoding: ${encoding || 'auto-detect'}`);
  const dgWs = new WebSocket(dgUrl, { headers: { Authorization: 'Token ' + dgKey } });

  dgWs.on('open', () => {
    console.log('[Deepgram] Proxy connected');
  });

  // Relay Deepgram transcription results back to browser
  dgWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      // Send as text string so browser receives it as a string, not Blob
      clientWs.send(data.toString());
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
    console.error('[Deepgram] WebSocket error:', err.message, err.code || '', err.toString());
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4002, 'Deepgram connection failed');
    }
  });

  dgWs.on('close', (code, reason) => {
    console.log('[Deepgram] WS closed code=' + code + ' reason=' + reason);
  });
});
