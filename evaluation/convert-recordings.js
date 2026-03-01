// convert-recordings.js — Convert recorded gameplay into training JSONL
//
// Reads evaluation/recorded-gameplay.jsonl (written by /api/record-gameplay)
// Outputs training examples in Mistral fine-tuning format
//
// Usage: node evaluation/convert-recordings.js [--input FILE] [--output FILE]

const fs = require("fs");
const path = require("path");

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
- ClownGuyTroop: cost 1, HP 10, DMG 10, speed 17 (cheap fast swarm unit)
- ClownLadyTroop: cost 1, HP 10, DMG 10, speed 17 (cheap fast swarm unit)
- LilDemonTroop: cost 2, HP 50, DMG 10, speed 20 (fast cheap attacker)
- AlienTroop: cost 3, HP 10, DMG 10, speed 17 (fast fragile unit)
- BattleOtterTroop: cost 3, HP 50, DMG 20, speed 15 (balanced fighter)
- ZDogTroop: cost 3, HP 40, DMG 20, speed 10 (steady fighter)
- QuackerTroop: cost 3, HP 50, DMG 5, speed 10 (spawns 3 flying units)
- WitchTroop: cost 4, HP 50, DMG 100, speed 10 (high damage, spawns puppies)
- MamaCowTroop: cost 4, HP 50, DMG 100, speed 10 (high damage, spawns baby cows)
- VolcanoTroop: cost 4, HP 50, DMG 100, speed 0 (stationary area damage building)
- EvilTroop: cost 5, HP 200, DMG 20, speed 10 (tanky high-health unit)
- ChickphinTroop: cost 6, HP 200, DMG 50, speed 8 (very tanky with good damage)
- TankTroop: cost 6, HP 200, DMG 200, speed 5 (massive damage and health, very slow)

Given the current game state and a command, respond with a JSON array of actions.
Each action: { "type": "play_card", "card": "<CardName>", "col": 0-9, "row": 0-5 }
If the command says to wait or you can't afford anything, return an empty array: []
Only play cards that are in the hand and affordable with current mana.
Place units strategically: tanks and fighters in rows 2-3, spawners behind in rows 4-5, swarm units in rows 1-2 for offense.`;

// Generate a natural-sounding command from the action context
function generateCommand(gameState, actions) {
  if (actions.length === 0) return "wait";

  const action = actions[0];
  const card = action.card;
  const col = action.col;
  const row = action.row;
  const side = col <= 4 ? "left" : "right";

  // Check game context for more realistic commands
  const enemiesOnSide = gameState.opponentTroops.filter(t =>
    side === "left" ? t.col <= 4 : t.col >= 5
  );
  const myTowerLow = gameState.myTowers.some(t => t.health < 300);

  const templates = [];

  if (enemiesOnSide.length > 0 && row >= 3) {
    templates.push(`defend ${side} side`);
    templates.push(`counter that ${side} push`);
    templates.push(`stop the push ${side}`);
  } else if (row <= 2) {
    templates.push(`push ${side} side`);
    templates.push(`attack ${side}`);
    templates.push(`send ${card.replace("Troop", "")} ${side}`);
  } else {
    templates.push(`play ${card.replace("Troop", "")} on the ${side} side`);
    templates.push(`drop ${card.replace("Troop", "")} at column ${col}`);
  }

  if (myTowerLow && row >= 3) {
    templates.push(`protect the ${side} tower`);
  }

  return templates[Math.floor(Math.random() * templates.length)];
}

function main() {
  const args = process.argv.slice(2);
  const inputFile = getArg(args, "--input") || path.join(__dirname, "recorded-gameplay.jsonl");
  const outputFile = getArg(args, "--output") || path.join(__dirname, "recorded-training-data.jsonl");

  if (!fs.existsSync(inputFile)) {
    console.error(`No recorded gameplay found at: ${inputFile}`);
    console.error("Play some games first! Recordings are saved automatically.");
    process.exit(1);
  }

  const lines = fs.readFileSync(inputFile, "utf-8").trim().split("\n");
  console.log(`Reading ${lines.length} recorded entries...`);

  const examples = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const batch = JSON.parse(line);
      const entries = batch.entries || [batch];

      for (const entry of entries) {
        const { gameState, actions } = entry;
        if (!gameState || !actions) { skipped++; continue; }

        // Generate a realistic command
        const command = generateCommand(gameState, actions);

        const userMessage = `Game state:\n${JSON.stringify(gameState, null, 2)}\n\nCommand: "${command}"`;
        const assistantMessage = JSON.stringify(actions);

        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
            { role: "assistant", content: assistantMessage },
          ],
        });
      }
    } catch (e) {
      skipped++;
    }
  }

  // Write output
  const ws = fs.createWriteStream(outputFile);
  for (const ex of examples) {
    ws.write(JSON.stringify(ex) + "\n");
  }
  ws.end();

  console.log(`Converted: ${examples.length} training examples`);
  console.log(`Skipped: ${skipped} invalid entries`);
  console.log(`Output: ${outputFile}`);
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

main();
