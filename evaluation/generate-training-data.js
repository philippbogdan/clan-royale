// generate-training-data.js — Generate fine-tuning JSONL for Mistral connector model
//
// Produces training examples that teach the connector model to translate
// natural language commands into correct GameAPI actions given a game state.
//
// Output format: Mistral fine-tuning JSONL
//   { "messages": [ { "role": "system", "content": "..." }, { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ] }
//
// Usage: node evaluation/generate-training-data.js --output training-data.jsonl --count 500

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Card catalog — mirrors actual game troop stats (IS_IN_DECK = true)
// ---------------------------------------------------------------------------
const CARD_CATALOG = {
  ClownGuyTroop:    { cost: 1, health: 10,  damage: 10,  speed: 17, role: "swarm",   desc: "cheap fast swarm unit" },
  ClownLadyTroop:   { cost: 1, health: 10,  damage: 10,  speed: 17, role: "swarm",   desc: "cheap fast swarm unit" },
  LilDemonTroop:    { cost: 2, health: 50,  damage: 10,  speed: 20, role: "swarm",   desc: "fast cheap attacker" },
  AlienTroop:       { cost: 3, health: 10,  damage: 10,  speed: 17, role: "swarm",   desc: "fast fragile unit" },
  BattleOtterTroop: { cost: 3, health: 50,  damage: 20,  speed: 15, role: "fighter", desc: "balanced fighter" },
  ZDogTroop:        { cost: 3, health: 40,  damage: 20,  speed: 10, role: "fighter", desc: "steady fighter" },
  QuackerTroop:     { cost: 3, health: 50,  damage: 5,   speed: 10, role: "spawner_flying", desc: "spawns 3 flying units" },
  WitchTroop:       { cost: 4, health: 50,  damage: 100, speed: 10, role: "spawner", desc: "high damage, spawns puppies" },
  MamaCowTroop:     { cost: 4, health: 50,  damage: 100, speed: 10, role: "spawner", desc: "high damage, spawns baby cows" },
  VolcanoTroop:     { cost: 4, health: 50,  damage: 100, speed: 0,  role: "building", desc: "stationary area damage building" },
  EvilTroop:        { cost: 5, health: 200, damage: 20,  speed: 10, role: "tank",    desc: "tanky high-health unit" },
  ChickphinTroop:   { cost: 6, health: 200, damage: 50,  speed: 8,  role: "tank",    desc: "very tanky with good damage" },
  TankTroop:        { cost: 6, health: 200, damage: 200, speed: 5,  role: "tank",    desc: "massive damage and health, very slow" },
};

const CARD_NAMES = Object.keys(CARD_CATALOG);

// Grid constants
const GRID_COLS = 10; // 0-9
const GRID_ROWS = 6;  // 0-5
const LEFT_BRIDGE_COLS = [1, 2];
const RIGHT_BRIDGE_COLS = [7, 8];

// ---------------------------------------------------------------------------
// System prompt for the connector model
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the action connector for Clan Royale, a real-time strategy card game. You translate natural language commands into game actions.

Game rules:
- Players have 1-10 mana. Cards cost mana to play.
- The battlefield is a 10-column (0-9) by 6-row (0-5) grid.
- Row 0 is near the river/bridges (aggressive forward position).
- Row 5 is near your own towers (defensive back position).
- Left bridge is at columns 1-2. Right bridge is at columns 7-8.
- Player towers: left tower (col 1-2, row 5), king tower (col 4-5, row 5), right tower (col 8, row 5).
- Opponent towers are at row 0 mirrored positions.
- Each tower has 1000 HP. Destroy opponent towers to win.

Card roster:
${Object.entries(CARD_CATALOG).map(([name, c]) => `- ${name}: cost ${c.cost}, HP ${c.health}, DMG ${c.damage}, speed ${c.speed} (${c.desc})`).join("\n")}

Given the current game state and a command, respond with a JSON array of actions.
Each action: { "type": "play_card", "card": "<CardName>", "col": 0-9, "row": 0-5 }
If the command says to wait or you can't afford anything, return an empty array: []
Only play cards that are in the hand and affordable with current mana.
Place units strategically: tanks and fighters in rows 2-3, spawners behind in rows 4-5, swarm units in rows 1-2 for offense.`;

// ---------------------------------------------------------------------------
// Command templates with expected behavior
// ---------------------------------------------------------------------------
const COMMAND_TEMPLATES = [
  // Direct card references with position
  { cmd: "drop {card} at column {col}", behavior: "play_specific_pos" },
  { cmd: "play {card} near the {side} bridge", behavior: "play_specific_bridge" },
  { cmd: "put {card} on the {side} side", behavior: "play_specific_side" },
  { cmd: "send {card} {side}", behavior: "play_specific_side" },
  { cmd: "place {card} at col {col} row {row}", behavior: "play_specific_exact" },
  { cmd: "drop {card} behind the king tower", behavior: "play_specific_behind_king" },
  { cmd: "play {card} in front of {side} tower", behavior: "play_specific_front_tower" },

  // Role-based commands
  { cmd: "drop a tank on the {side} side", behavior: "play_role", role: "tank" },
  { cmd: "send swarm {side}", behavior: "play_role", role: "swarm" },
  { cmd: "play something cheap {side}", behavior: "play_cheap" },
  { cmd: "play the cheapest card {side}", behavior: "play_cheap" },
  { cmd: "drop a spawner behind my troops", behavior: "play_role_behind", role: "spawner" },
  { cmd: "put down a fighter at the {side} bridge", behavior: "play_role_bridge", role: "fighter" },
  { cmd: "place a building in the center", behavior: "play_role_center", role: "building" },

  // Defensive commands
  { cmd: "defend {side} side", behavior: "defend" },
  { cmd: "protect the {side} tower", behavior: "defend" },
  { cmd: "stop the push {side}", behavior: "defend" },
  { cmd: "counter that {side} push", behavior: "defend" },
  { cmd: "block the {side} bridge", behavior: "defend_bridge" },

  // Aggressive commands
  { cmd: "go all in {side}", behavior: "all_in" },
  { cmd: "rush {side} side", behavior: "all_in" },
  { cmd: "push {side} hard", behavior: "all_in" },
  { cmd: "counter-push {side}", behavior: "attack" },
  { cmd: "attack {side} side", behavior: "attack" },
  { cmd: "pressure the {side} bridge", behavior: "attack_bridge" },

  // Wait/save
  { cmd: "save mana", behavior: "wait" },
  { cmd: "hold, don't play anything", behavior: "wait" },
  { cmd: "wait for more elixir", behavior: "wait" },

  // Split push
  { cmd: "split push both sides", behavior: "split" },
  { cmd: "pressure both bridges", behavior: "split" },

  // Position-aware
  { cmd: "drop something where the enemy is pushing", behavior: "counter_position" },
  { cmd: "place troops to match their push", behavior: "counter_position" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomHand(count) {
  const shuffled = [...CARD_NAMES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randCol() {
  return randBetween(0, GRID_COLS - 1);
}

function randRow() {
  return randBetween(0, GRID_ROWS - 1);
}

function clampCol(c) {
  return Math.max(0, Math.min(GRID_COLS - 1, c));
}

function clampRow(r) {
  return Math.max(0, Math.min(GRID_ROWS - 1, r));
}

// Returns a col in the "left side" range (0-4) or "right side" range (5-9)
function sideCol(side) {
  return side === "left" ? randBetween(0, 4) : randBetween(5, 9);
}

function bridgeCol(side) {
  return side === "left" ? pickRandom(LEFT_BRIDGE_COLS) : pickRandom(RIGHT_BRIDGE_COLS);
}

// ---------------------------------------------------------------------------
// Game state generator — uses grid coords
// ---------------------------------------------------------------------------
function generateState(opts = {}) {
  const mana = opts.mana ?? randBetween(1, 10);
  const hand = opts.hand || pickRandomHand(4);

  return {
    mana,
    maxMana: 10,
    hand: hand.map((name, i) => ({ name, cost: CARD_CATALOG[name].cost, slotIndex: i })),
    myTroops: opts.myTroops || generateRandomTroops(randBetween(0, 4), "my"),
    opponentTroops: opts.opponentTroops || generateRandomTroops(randBetween(0, 4), "opponent"),
    myTowers: opts.myTowers || [
      { col: randBetween(4, 5), row: 5, health: randBetween(500, 1000) }, // king
      { col: randBetween(1, 2), row: 5, health: randBetween(300, 1000) }, // left
      { col: 8, row: 5, health: randBetween(300, 1000) },                 // right
    ],
    opponentTowers: opts.opponentTowers || [
      { col: randBetween(4, 5), row: 0, health: randBetween(500, 1000) }, // king
      { col: randBetween(1, 2), row: 0, health: randBetween(300, 1000) }, // left
      { col: 8, row: 0, health: randBetween(300, 1000) },                 // right
    ],
    gameStatus: "playing",
    grid: {
      cols: 10, rows: 6,
      bridges: [{ col: 1, side: "left" }, { col: 8, side: "right" }],
      note: "row 0 = river/bridges (aggressive), row 5 = near your towers (defensive). Left bridge col 1-2, right bridge col 7-8."
    }
  };
}

function generateRandomTroops(count, owner) {
  const troops = [];
  for (let i = 0; i < count; i++) {
    const name = pickRandom(CARD_NAMES);
    const rowRange = owner === "my" ? [1, 4] : [0, 3];
    troops.push({
      name,
      col: randCol(),
      row: randBetween(rowRange[0], rowRange[1]),
      health: randBetween(10, CARD_CATALOG[name].health)
    });
  }
  return troops;
}

// ---------------------------------------------------------------------------
// Strategic position picker — varies position by role
// ---------------------------------------------------------------------------
function strategicPosition(cardName, side, context) {
  const info = CARD_CATALOG[cardName];
  if (!info) return { col: sideCol(side), row: randBetween(2, 4) };

  const role = info.role;
  let col, row;

  switch (role) {
    case "tank":
      // Tanks: rows 2-3 for defense, rows 0-1 for offense
      if (context === "defend") {
        row = randBetween(3, 4);
        col = sideCol(side) + randBetween(-1, 1);
      } else {
        row = randBetween(1, 3);
        col = sideCol(side) + randBetween(-1, 1);
      }
      break;

    case "spawner":
      // Spawners: rows 4-5, behind the front line
      row = randBetween(4, 5);
      col = sideCol(side) + randBetween(-1, 1);
      break;

    case "spawner_flying":
      // Quacker: rows 3-4
      row = randBetween(3, 4);
      col = sideCol(side) + randBetween(-1, 1);
      break;

    case "swarm":
      // Swarm: rows 1-2 for offense, match enemy column if defending
      if (context === "defend") {
        row = randBetween(2, 3);
        col = sideCol(side) + randBetween(-1, 1);
      } else {
        row = randBetween(1, 2);
        col = sideCol(side) + randBetween(-1, 1);
      }
      break;

    case "building":
      // Buildings: center, rows 3-4
      col = randBetween(3, 6);
      row = randBetween(3, 4);
      break;

    case "fighter":
      // Fighters: versatile, rows 2-3
      row = randBetween(2, 3);
      col = sideCol(side) + randBetween(-1, 1);
      break;

    default:
      row = randBetween(2, 4);
      col = sideCol(side);
      break;
  }

  return { col: clampCol(col), row: clampRow(row) };
}

// ---------------------------------------------------------------------------
// Ideal response generator — produces correct actions for a command
// ---------------------------------------------------------------------------
function generateIdealResponse(state, command, template) {
  const hand = state.hand;
  const mana = state.mana;
  const affordable = hand.filter(c => c.cost <= mana);

  // Determine which side from the command
  const side = command.includes("left") ? "left" : command.includes("right") ? "right" : pickRandom(["left", "right"]);

  switch (template.behavior) {
    case "play_specific_pos": {
      const cardInCmd = hand.find(c => command.toLowerCase().includes(c.name.toLowerCase().replace("troop", "")));
      if (cardInCmd && cardInCmd.cost <= mana) {
        const colMatch = command.match(/column\s*(\d)/);
        const col = colMatch ? clampCol(parseInt(colMatch[1])) : sideCol(side);
        const pos = strategicPosition(cardInCmd.name, side, "attack");
        return [{ type: "play_card", card: cardInCmd.name, col, row: pos.row }];
      }
      return [];
    }

    case "play_specific_bridge": {
      const cardInCmd = hand.find(c => command.toLowerCase().includes(c.name.toLowerCase().replace("troop", "")));
      if (cardInCmd && cardInCmd.cost <= mana) {
        const col = bridgeCol(side);
        const pos = strategicPosition(cardInCmd.name, side, "attack");
        return [{ type: "play_card", card: cardInCmd.name, col, row: pos.row }];
      }
      return [];
    }

    case "play_specific_side": {
      const cardInCmd = hand.find(c => command.toLowerCase().includes(c.name.toLowerCase().replace("troop", "")));
      if (cardInCmd && cardInCmd.cost <= mana) {
        const pos = strategicPosition(cardInCmd.name, side, "attack");
        return [{ type: "play_card", card: cardInCmd.name, col: pos.col, row: pos.row }];
      }
      return [];
    }

    case "play_specific_exact": {
      const cardInCmd = hand.find(c => command.toLowerCase().includes(c.name.toLowerCase().replace("troop", "")));
      if (cardInCmd && cardInCmd.cost <= mana) {
        const colMatch = command.match(/col\s*(\d)/);
        const rowMatch = command.match(/row\s*(\d)/);
        const col = colMatch ? clampCol(parseInt(colMatch[1])) : sideCol(side);
        const row = rowMatch ? clampRow(parseInt(rowMatch[1])) : 3;
        return [{ type: "play_card", card: cardInCmd.name, col, row }];
      }
      return [];
    }

    case "play_specific_behind_king": {
      const cardInCmd = hand.find(c => command.toLowerCase().includes(c.name.toLowerCase().replace("troop", "")));
      if (cardInCmd && cardInCmd.cost <= mana) {
        const col = randBetween(3, 6);
        const row = 5;
        return [{ type: "play_card", card: cardInCmd.name, col, row }];
      }
      return [];
    }

    case "play_specific_front_tower": {
      const cardInCmd = hand.find(c => command.toLowerCase().includes(c.name.toLowerCase().replace("troop", "")));
      if (cardInCmd && cardInCmd.cost <= mana) {
        const col = side === "left" ? randBetween(1, 3) : randBetween(7, 9);
        const row = randBetween(3, 4);
        return [{ type: "play_card", card: cardInCmd.name, col, row }];
      }
      return [];
    }

    case "play_role": {
      const role = template.role;
      const match = affordable.find(c => CARD_CATALOG[c.name].role === role);
      if (match) {
        const pos = strategicPosition(match.name, side, "attack");
        return [{ type: "play_card", card: match.name, col: pos.col, row: pos.row }];
      }
      if (affordable.length > 0) {
        const pos = strategicPosition(affordable[0].name, side, "attack");
        return [{ type: "play_card", card: affordable[0].name, col: pos.col, row: pos.row }];
      }
      return [];
    }

    case "play_role_behind": {
      const role = template.role;
      const match = affordable.find(c => CARD_CATALOG[c.name].role === role || CARD_CATALOG[c.name].role === "spawner_flying");
      if (match) {
        const col = sideCol(side) + randBetween(-1, 1);
        return [{ type: "play_card", card: match.name, col: clampCol(col), row: randBetween(4, 5) }];
      }
      return [];
    }

    case "play_role_bridge": {
      const role = template.role;
      const match = affordable.find(c => CARD_CATALOG[c.name].role === role);
      if (match) {
        const col = bridgeCol(side);
        const pos = strategicPosition(match.name, side, "attack");
        return [{ type: "play_card", card: match.name, col, row: pos.row }];
      }
      return [];
    }

    case "play_role_center": {
      const role = template.role;
      const match = affordable.find(c => CARD_CATALOG[c.name].role === role);
      if (match) {
        return [{ type: "play_card", card: match.name, col: randBetween(3, 6), row: randBetween(3, 4) }];
      }
      if (affordable.length > 0) {
        return [{ type: "play_card", card: affordable[0].name, col: randBetween(3, 6), row: randBetween(3, 4) }];
      }
      return [];
    }

    case "play_cheap": {
      if (affordable.length === 0) return [];
      const cheapest = affordable.reduce((a, b) => a.cost <= b.cost ? a : b);
      const pos = strategicPosition(cheapest.name, side, "attack");
      return [{ type: "play_card", card: cheapest.name, col: pos.col, row: pos.row }];
    }

    case "defend": {
      const defenders = affordable.filter(c => {
        const info = CARD_CATALOG[c.name];
        return info.role === "tank" || info.role === "fighter" || info.role === "building";
      });
      const pick = defenders.length > 0 ? defenders[0] : affordable[0];
      if (pick) {
        // Place defenders to match enemy column range if enemies present
        let col;
        const enemiesOnSide = state.opponentTroops.filter(t =>
          side === "left" ? t.col <= 4 : t.col >= 5
        );
        if (enemiesOnSide.length > 0) {
          col = clampCol(enemiesOnSide[0].col + randBetween(-1, 1));
        } else {
          col = sideCol(side);
        }
        const pos = strategicPosition(pick.name, side, "defend");
        return [{ type: "play_card", card: pick.name, col, row: pos.row }];
      }
      return [];
    }

    case "defend_bridge": {
      const defenders = affordable.filter(c => {
        const info = CARD_CATALOG[c.name];
        return info.role === "tank" || info.role === "fighter" || info.role === "building";
      });
      const pick = defenders.length > 0 ? defenders[0] : affordable[0];
      if (pick) {
        const col = bridgeCol(side);
        return [{ type: "play_card", card: pick.name, col, row: randBetween(2, 3) }];
      }
      return [];
    }

    case "attack": {
      if (affordable.length === 0) return [];
      const sorted = [...affordable].sort((a, b) => CARD_CATALOG[b.name].damage - CARD_CATALOG[a.name].damage);
      const pos = strategicPosition(sorted[0].name, side, "attack");
      return [{ type: "play_card", card: sorted[0].name, col: pos.col, row: pos.row }];
    }

    case "attack_bridge": {
      if (affordable.length === 0) return [];
      const sorted = [...affordable].sort((a, b) => CARD_CATALOG[b.name].damage - CARD_CATALOG[a.name].damage);
      const col = bridgeCol(side);
      return [{ type: "play_card", card: sorted[0].name, col, row: randBetween(1, 2) }];
    }

    case "all_in": {
      const actions = [];
      let remainingMana = mana;
      const sorted = [...affordable].sort((a, b) => b.cost - a.cost);
      for (const card of sorted) {
        if (card.cost <= remainingMana) {
          const pos = strategicPosition(card.name, side, "attack");
          // Add slight col variation so units don't stack on same cell
          const colVariation = actions.length > 0 ? randBetween(-1, 1) : 0;
          actions.push({
            type: "play_card",
            card: card.name,
            col: clampCol(pos.col + colVariation),
            row: clampRow(pos.row + randBetween(-1, 0))
          });
          remainingMana -= card.cost;
        }
      }
      return actions;
    }

    case "split": {
      const actions = [];
      let remainingMana = mana;
      if (affordable.length >= 2) {
        const posL = strategicPosition(affordable[0].name, "left", "attack");
        actions.push({ type: "play_card", card: affordable[0].name, col: posL.col, row: posL.row });
        remainingMana -= affordable[0].cost;
        const second = affordable.slice(1).find(c => c.cost <= remainingMana);
        if (second) {
          const posR = strategicPosition(second.name, "right", "attack");
          actions.push({ type: "play_card", card: second.name, col: posR.col, row: posR.row });
        }
      } else if (affordable.length === 1) {
        const pos = strategicPosition(affordable[0].name, "left", "attack");
        actions.push({ type: "play_card", card: affordable[0].name, col: pos.col, row: pos.row });
      }
      return actions;
    }

    case "counter_position": {
      if (affordable.length === 0) return [];
      // Find the side with more enemy troops and counter there
      const leftEnemies = state.opponentTroops.filter(t => t.col <= 4);
      const rightEnemies = state.opponentTroops.filter(t => t.col >= 5);
      const counterSide = leftEnemies.length >= rightEnemies.length ? "left" : "right";
      const enemies = counterSide === "left" ? leftEnemies : rightEnemies;

      // Place near the enemy cluster
      const defenders = affordable.filter(c => {
        const info = CARD_CATALOG[c.name];
        return info.role === "tank" || info.role === "fighter";
      });
      const pick = defenders.length > 0 ? defenders[0] : affordable[0];

      let col;
      if (enemies.length > 0) {
        const avgCol = Math.round(enemies.reduce((s, e) => s + e.col, 0) / enemies.length);
        col = clampCol(avgCol + randBetween(-1, 1));
      } else {
        col = sideCol(counterSide);
      }
      const pos = strategicPosition(pick.name, counterSide, "defend");
      return [{ type: "play_card", card: pick.name, col, row: pos.row }];
    }

    case "wait":
      return [];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Training example generation
// ---------------------------------------------------------------------------
function generateTrainingExample() {
  const template = pickRandom(COMMAND_TEMPLATES);
  const side = pickRandom(["left", "right"]);
  const hand = pickRandomHand(4);

  let state;
  let command = template.cmd;

  if (template.behavior === "play_specific_pos" || template.behavior === "play_specific_bridge" ||
      template.behavior === "play_specific_side" || template.behavior === "play_specific_exact" ||
      template.behavior === "play_specific_behind_king" || template.behavior === "play_specific_front_tower") {
    const card = pickRandom(hand);
    const displayName = card.replace(/([A-Z])/g, " $1").trim().toLowerCase().replace("troop", "").trim();
    command = command.replace("{card}", displayName).replace("{side}", side);
    command = command.replace("{col}", String(sideCol(side)));
    command = command.replace("{row}", String(randBetween(1, 4)));
    state = generateState({ hand, mana: randBetween(CARD_CATALOG[card].cost, 10) });
  } else if (template.behavior === "play_role" || template.behavior === "play_role_behind" ||
             template.behavior === "play_role_bridge" || template.behavior === "play_role_center") {
    const role = template.role;
    const roleCards = CARD_NAMES.filter(n => CARD_CATALOG[n].role === role);
    if (roleCards.length > 0) {
      hand[0] = pickRandom(roleCards);
    }
    command = command.replace("{side}", side);
    state = generateState({ hand, mana: randBetween(3, 10) });
  } else {
    command = command.replace("{side}", side);
    const minMana = template.behavior === "wait" ? randBetween(1, 4) : randBetween(2, 10);
    state = generateState({ hand, mana: minMana });
  }

  const idealActions = generateIdealResponse(state, command, template);

  const userMessage = `Game state:
${JSON.stringify(state, null, 2)}

Command: "${command}"`;

  const assistantMessage = JSON.stringify(idealActions);

  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
      { role: "assistant", content: assistantMessage },
    ],
  };
}

// ---------------------------------------------------------------------------
// Scenario-specific examples for edge cases
// ---------------------------------------------------------------------------
function generateEdgeCaseExamples() {
  const examples = [];

  // Edge case 1: No affordable cards
  {
    const hand = ["TankTroop", "ChickphinTroop", "EvilTroop", "WitchTroop"];
    const state = generateState({ hand, mana: 1, myTroops: [], opponentTroops: [] });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "drop something on the left side"` },
        { role: "assistant", content: "[]" },
      ],
    });
  }

  // Edge case 2: Card not in hand
  {
    const hand = ["ClownGuyTroop", "LilDemonTroop", "AlienTroop", "BattleOtterTroop"];
    const state = generateState({ hand, mana: 8, myTroops: [], opponentTroops: [] });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "play tank troop at col 3 row 2"` },
        { role: "assistant", content: "[]" },
      ],
    });
  }

  // Edge case 3: Tower critical — should defend at enemy column
  {
    const hand = ["TankTroop", "BattleOtterTroop", "ClownGuyTroop", "LilDemonTroop"];
    const state = generateState({
      hand,
      mana: 7,
      myTowers: [
        { col: 4, row: 5, health: 1000 },
        { col: 1, row: 5, health: 50 },
        { col: 8, row: 5, health: 1000 },
      ],
      opponentTroops: [
        { name: "EvilTroop", col: 2, row: 3, health: 150 },
      ],
      myTroops: [],
    });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "defend left side, tower is low!"` },
        { role: "assistant", content: JSON.stringify([{ type: "play_card", card: "TankTroop", col: 2, row: 3 }]) },
      ],
    });
  }

  // Edge case 4: Full mana — should spend aggressively on one side
  {
    const hand = ["WitchTroop", "BattleOtterTroop", "ClownGuyTroop", "LilDemonTroop"];
    const state = generateState({ hand, mana: 10, myTroops: [], opponentTroops: [] });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "mana is full, go all in right"` },
        { role: "assistant", content: JSON.stringify([
          { type: "play_card", card: "WitchTroop", col: 7, row: 4 },
          { type: "play_card", card: "BattleOtterTroop", col: 8, row: 2 },
          { type: "play_card", card: "LilDemonTroop", col: 7, row: 1 },
          { type: "play_card", card: "ClownGuyTroop", col: 8, row: 1 },
        ]) },
      ],
    });
  }

  // Edge case 5: Counter push — match enemy position
  {
    const hand = ["BattleOtterTroop", "ZDogTroop", "ClownGuyTroop", "QuackerTroop"];
    const state = generateState({
      hand,
      mana: 5,
      opponentTroops: [
        { name: "TankTroop", col: 7, row: 2, health: 200 },
        { name: "EvilTroop", col: 8, row: 3, health: 150 },
      ],
      myTroops: [],
    });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "counter that right push"` },
        { role: "assistant", content: JSON.stringify([{ type: "play_card", card: "BattleOtterTroop", col: 7, row: 3 }]) },
      ],
    });
  }

  // Edge case 6: Bridge control — place at bridge
  {
    const hand = ["EvilTroop", "ZDogTroop", "AlienTroop", "LilDemonTroop"];
    const state = generateState({
      hand,
      mana: 6,
      myTroops: [],
      opponentTroops: [{ name: "ClownGuyTroop", col: 1, row: 1, health: 10 }],
    });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "block the left bridge"` },
        { role: "assistant", content: JSON.stringify([{ type: "play_card", card: "EvilTroop", col: 1, row: 3 }]) },
      ],
    });
  }

  // Edge case 7: Building placement in center
  {
    const hand = ["VolcanoTroop", "ClownGuyTroop", "LilDemonTroop", "AlienTroop"];
    const state = generateState({ hand, mana: 5, myTroops: [], opponentTroops: [] });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "place a building in the center"` },
        { role: "assistant", content: JSON.stringify([{ type: "play_card", card: "VolcanoTroop", col: 5, row: 4 }]) },
      ],
    });
  }

  // Edge case 8: Spawner behind troops
  {
    const hand = ["WitchTroop", "BattleOtterTroop", "ClownGuyTroop", "LilDemonTroop"];
    const state = generateState({
      hand,
      mana: 6,
      myTroops: [
        { name: "EvilTroop", col: 3, row: 2, health: 180 },
      ],
      opponentTroops: [],
    });
    examples.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Game state:\n${JSON.stringify(state, null, 2)}\n\nCommand: "drop a spawner behind my troops"` },
        { role: "assistant", content: JSON.stringify([{ type: "play_card", card: "WitchTroop", col: 3, row: 4 }]) },
      ],
    });
  }

  return examples;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const outputFile = getArg(args, "--output") || path.join(__dirname, "training-data.jsonl");
  const count = parseInt(getArg(args, "--count") || "500", 10);

  console.log(`Generating ${count} training examples...`);

  const examples = [];

  // Add edge case examples first
  const edgeCases = generateEdgeCaseExamples();
  examples.push(...edgeCases);
  console.log(`  Added ${edgeCases.length} edge case examples`);

  // Generate random examples
  const randomCount = count - edgeCases.length;
  for (let i = 0; i < randomCount; i++) {
    examples.push(generateTrainingExample());
  }
  console.log(`  Generated ${randomCount} random examples`);

  // Shuffle to mix edge cases with random examples
  for (let i = examples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [examples[i], examples[j]] = [examples[j], examples[i]];
  }

  // Write JSONL
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const writeStream = fs.createWriteStream(outputFile);
  for (const example of examples) {
    writeStream.write(JSON.stringify(example) + "\n");
  }
  writeStream.end();

  console.log(`\nOutput: ${outputFile}`);
  console.log(`Total examples: ${examples.length}`);

  // Print distribution stats
  const behaviors = {};
  for (const tmpl of COMMAND_TEMPLATES) {
    behaviors[tmpl.behavior] = (behaviors[tmpl.behavior] || 0) + 1;
  }
  console.log("\nCommand template distribution:");
  for (const [behavior, templateCount] of Object.entries(behaviors)) {
    console.log(`  ${behavior}: ${templateCount} templates`);
  }

  // Validate: sample a few examples and check grid bounds
  let valid = 0;
  let invalid = 0;
  for (const ex of examples) {
    const assistantMsg = ex.messages[2].content;
    try {
      const actions = JSON.parse(assistantMsg);
      let ok = true;
      for (const a of actions) {
        if (a.col < 0 || a.col > 9 || a.row < 0 || a.row > 5) ok = false;
        if (a.lane !== undefined) { ok = false; } // should never have lane
      }
      if (ok) valid++; else invalid++;
    } catch {
      invalid++;
    }
  }
  console.log(`\nValidation: ${valid} valid, ${invalid} invalid (out of ${examples.length})`);
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

main();
