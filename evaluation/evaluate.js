// evaluate.js — Head-to-head metrics for fine-tuned vs base Qwen comparison
//
// Parses JSONL decision logs from run-match.js (head-to-head matches).
// Each match has decisions from BOTH sides:
//   side: "player" = fine-tuned Qwen
//   side: "opponent" = base Qwen
//
// Usage: node evaluation/evaluate.js --logs evaluation/logs/ --output evaluation/results.json

const fs = require("fs");
const path = require("path");

const GRID_COLS = 10;
const GRID_ROWS = 6;

// ---------------------------------------------------------------------------
// JSONL parsing — reads all .jsonl match files
// ---------------------------------------------------------------------------

function readAllLogs(logsDir) {
  if (!fs.existsSync(logsDir)) {
    console.error(`Logs directory not found: ${logsDir}`);
    return [];
  }

  const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl") && f.startsWith("match-"));
  let allEntries = [];

  for (const file of files) {
    const filePath = path.join(logsDir, file);
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(l => l.trim());
    for (const line of lines) {
      try {
        allEntries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
  }
  return allEntries;
}

// ---------------------------------------------------------------------------
// Metric: Win rate (from summary.json)
// ---------------------------------------------------------------------------

function readWinRate(logsDir) {
  const summaryPath = path.join(logsDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    return { finetunedWins: 0, baseWins: 0, errors: 0, total: 0, finetunedWinRate: 0, baseWinRate: 0 };
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  return {
    finetunedWins: summary.finetunedWins || 0,
    baseWins: summary.baseWins || 0,
    errors: summary.errors || 0,
    total: summary.completed || 0,
    finetunedWinRate: summary.finetunedWinRate || 0,
    baseWinRate: summary.baseWinRate || 0
  };
}

// ---------------------------------------------------------------------------
// Metric: Placement variety — unique (col, row) cells used
// ---------------------------------------------------------------------------

function computePlacementVariety(entries) {
  const cells = new Set();
  let totalPlacements = 0;

  for (const entry of entries) {
    for (const action of entry.actions || []) {
      if (action.col != null && action.row != null) {
        cells.add(`${action.col},${action.row}`);
        totalPlacements++;
      }
    }
  }

  return {
    uniqueCells: cells.size,
    maxPossible: GRID_COLS * GRID_ROWS,
    totalPlacements,
    variety: `${cells.size}/${GRID_COLS * GRID_ROWS}`
  };
}

// ---------------------------------------------------------------------------
// Metric: Placement heatmap — distribution across 10x6 grid
// ---------------------------------------------------------------------------

function computePlacementHeatmap(entries) {
  const grid = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(0));
  let total = 0;

  for (const entry of entries) {
    for (const action of entry.actions || []) {
      if (action.col != null && action.row != null) {
        const c = Math.max(0, Math.min(GRID_COLS - 1, action.col));
        const r = Math.max(0, Math.min(GRID_ROWS - 1, action.row));
        grid[r][c]++;
        total++;
      }
    }
  }

  return { grid, total };
}

// ---------------------------------------------------------------------------
// Metric: Strategic accuracy
// ---------------------------------------------------------------------------

function computeStrategicAccuracy(entries) {
  let towerLowSituations = 0;
  let defensiveWhenTowerLow = 0;
  let manaFullSituations = 0;
  let offensiveWhenManaFull = 0;

  for (const entry of entries) {
    const gs = entry.gameState;
    if (!gs) continue;

    const actions = entry.actions || [];
    if (actions.length === 0) continue;

    const myTowers = gs.myTowers || [];
    const hasLowTower = myTowers.some(t => t.health > 0 && t.health < 300);

    if (hasLowTower) {
      towerLowSituations++;
      const defensiveActions = actions.filter(a => a.row != null && a.row >= 3);
      if (defensiveActions.length > 0) {
        defensiveWhenTowerLow++;
      }
    }

    if (gs.mana >= 9) {
      manaFullSituations++;
      const offensiveActions = actions.filter(a => a.row != null && a.row <= 2);
      if (offensiveActions.length > 0) {
        offensiveWhenManaFull++;
      }
    }
  }

  return {
    towerLowSituations,
    defensiveWhenTowerLow,
    defensiveRate: towerLowSituations > 0 ? defensiveWhenTowerLow / towerLowSituations : 0,
    manaFullSituations,
    offensiveWhenManaFull,
    offensiveRate: manaFullSituations > 0 ? offensiveWhenManaFull / manaFullSituations : 0
  };
}

// ---------------------------------------------------------------------------
// Metric: Mana efficiency
// ---------------------------------------------------------------------------

function computeManaEfficiency(entries) {
  let totalManaAvailable = 0;
  let totalManaSpent = 0;

  const CARD_COSTS = {
    ClownGuyTroop: 1, ClownLadyTroop: 1, LilDemonTroop: 2, AlienTroop: 3,
    BattleOtterTroop: 3, ZDogTroop: 3, QuackerTroop: 3,
    WitchTroop: 4, MamaCowTroop: 4, VolcanoTroop: 4,
    EvilTroop: 5, ChickphinTroop: 6, TankTroop: 6
  };

  for (const entry of entries) {
    const gs = entry.gameState;
    if (!gs) continue;

    totalManaAvailable += gs.mana || 0;

    for (const action of entry.actions || []) {
      const cost = CARD_COSTS[action.card] || 0;
      totalManaSpent += cost;
    }
  }

  return {
    totalManaAvailable,
    totalManaSpent,
    efficiency: totalManaAvailable > 0 ? totalManaSpent / totalManaAvailable : 0
  };
}

// ---------------------------------------------------------------------------
// Metric: Action validity (col/row bounds, card in hand, mana check)
// ---------------------------------------------------------------------------

function computeActionValidity(entries) {
  let totalActions = 0;
  let validActions = 0;
  let outOfBounds = 0;
  let cardNotInHand = 0;
  let notEnoughMana = 0;

  const CARD_COSTS = {
    ClownGuyTroop: 1, ClownLadyTroop: 1, LilDemonTroop: 2, AlienTroop: 3,
    BattleOtterTroop: 3, ZDogTroop: 3, QuackerTroop: 3,
    WitchTroop: 4, MamaCowTroop: 4, VolcanoTroop: 4,
    EvilTroop: 5, ChickphinTroop: 6, TankTroop: 6
  };

  for (const entry of entries) {
    const gs = entry.gameState;
    if (!gs) continue;
    let manaLeft = gs.mana || 0;

    for (const action of entry.actions || []) {
      totalActions++;
      let valid = true;

      if (action.col == null || action.row == null ||
          action.col < 0 || action.col > 9 || action.row < 0 || action.row > 5) {
        outOfBounds++;
        valid = false;
      }

      const hand = gs.hand || [];
      const inHand = hand.some(c => c.name && c.name.toLowerCase() === (action.card || "").toLowerCase());
      if (!inHand) {
        cardNotInHand++;
        valid = false;
      }

      const cost = CARD_COSTS[action.card] || 0;
      if (cost > manaLeft) {
        notEnoughMana++;
        valid = false;
      } else {
        manaLeft -= cost;
      }

      if (valid) validActions++;
    }
  }

  return {
    totalActions,
    validActions,
    validityRate: totalActions > 0 ? validActions / totalActions : 0,
    outOfBounds,
    cardNotInHand,
    notEnoughMana
  };
}

// ---------------------------------------------------------------------------
// Aggregate all metrics for one side
// ---------------------------------------------------------------------------

function computeAllMetrics(entries) {
  return {
    count: entries.length,
    placementVariety: computePlacementVariety(entries),
    placementHeatmap: computePlacementHeatmap(entries),
    strategicAccuracy: computeStrategicAccuracy(entries),
    manaEfficiency: computeManaEfficiency(entries),
    actionValidity: computeActionValidity(entries)
  };
}

// ---------------------------------------------------------------------------
// Pretty-print comparison table
// ---------------------------------------------------------------------------

function fmtPct(v) { return (v * 100).toFixed(1) + "%"; }
function fmtDelta(v) { const s = (v * 100).toFixed(1); return (v >= 0 ? "+" : "") + s + "%"; }
function fmtNum(v) { return String(v); }

function printComparisonTable(winRate, ft, base) {
  const W = 72;
  console.log("\n" + "=".repeat(W));
  console.log("  HEAD-TO-HEAD: Fine-tuned Qwen vs Base Qwen");
  console.log("  (Both sides orchestrated by Grok 4.1 Fast)");
  console.log("=".repeat(W));
  console.log();

  // Win rate section
  console.log(`  WIN RATE (${winRate.total} matches)`);
  console.log(`  Fine-tuned wins: ${winRate.finetunedWins} (${fmtPct(winRate.finetunedWinRate)})`);
  console.log(`  Base wins:       ${winRate.baseWins} (${fmtPct(winRate.baseWinRate)})`);
  console.log(`  Errors/Timeouts: ${winRate.errors}`);
  console.log();

  // Behavioral metrics
  const header = "Metric".padEnd(28) + "Fine-tuned".padEnd(14) + "Base".padEnd(14) + "Delta";
  console.log(header);
  console.log("-".repeat(W));

  const rows = [
    ["Placement Variety", ft.placementVariety.variety, base.placementVariety.variety, fmtDelta((ft.placementVariety.uniqueCells - base.placementVariety.uniqueCells) / 60)],
    ["Action Validity", fmtPct(ft.actionValidity.validityRate), fmtPct(base.actionValidity.validityRate), fmtDelta(ft.actionValidity.validityRate - base.actionValidity.validityRate)],
    ["Mana Efficiency", fmtPct(ft.manaEfficiency.efficiency), fmtPct(base.manaEfficiency.efficiency), fmtDelta(ft.manaEfficiency.efficiency - base.manaEfficiency.efficiency)],
    ["Defensive When Low HP", fmtPct(ft.strategicAccuracy.defensiveRate), fmtPct(base.strategicAccuracy.defensiveRate), fmtDelta(ft.strategicAccuracy.defensiveRate - base.strategicAccuracy.defensiveRate)],
    ["Offensive When Full Mana", fmtPct(ft.strategicAccuracy.offensiveRate), fmtPct(base.strategicAccuracy.offensiveRate), fmtDelta(ft.strategicAccuracy.offensiveRate - base.strategicAccuracy.offensiveRate)],
    ["Total Decisions", fmtNum(ft.count), fmtNum(base.count), ""],
    ["Total Actions", fmtNum(ft.actionValidity.totalActions), fmtNum(base.actionValidity.totalActions), ""],
  ];

  for (const [label, fv, bv, dv] of rows) {
    console.log(label.padEnd(28) + fv.padEnd(14) + bv.padEnd(14) + dv);
  }
  console.log();
}

function printHeatmap(label, heatmap) {
  console.log(`--- Placement Heatmap (${label}) ---`);
  console.log("     " + Array.from({ length: GRID_COLS }, (_, i) => `c${i}`.padStart(4)).join(""));
  for (let r = 0; r < GRID_ROWS; r++) {
    const rowLabel = r === 0 ? "r0(river)" : r === 5 ? "r5(base) " : `r${r}       `;
    const cells = heatmap.grid[r].map(v => String(v).padStart(4)).join("");
    console.log(`  ${rowLabel.substring(0, 9)}${cells}`);
  }
  console.log(`  Total placements: ${heatmap.total}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const logsDir = getArg(args, "--logs") || path.join(__dirname, "logs");
  const outputFile = getArg(args, "--output") || path.join(__dirname, "results.json");

  // Read all entries and split by side
  const allEntries = readAllLogs(logsDir);
  const ftEntries = allEntries.filter(e => e.side === "player");   // fine-tuned
  const baseEntries = allEntries.filter(e => e.side === "opponent"); // base

  console.log(`Loaded ${allEntries.length} total entries from ${logsDir}`);
  console.log(`  Fine-tuned (player) decisions: ${ftEntries.length}`);
  console.log(`  Base (opponent) decisions:      ${baseEntries.length}`);

  if (allEntries.length === 0) {
    console.error("\nNo log files found. Run matches first:");
    console.error("  node evaluation/run-match.js --matches 100 --parallel 5 --output evaluation/logs/");
    process.exit(1);
  }

  // Win rate from summary.json
  const winRate = readWinRate(logsDir);

  // Compute per-side behavioral metrics
  const ftMetrics = ftEntries.length > 0 ? computeAllMetrics(ftEntries) : null;
  const baseMetrics = baseEntries.length > 0 ? computeAllMetrics(baseEntries) : null;

  // Print results
  if (ftMetrics && baseMetrics) {
    printComparisonTable(winRate, ftMetrics, baseMetrics);
    printHeatmap("Fine-tuned (player)", ftMetrics.placementHeatmap);
    printHeatmap("Base (opponent)", baseMetrics.placementHeatmap);
  }

  // Write results.json
  const output = {
    timestamp: new Date().toISOString(),
    mode: "head-to-head",
    logsDir,
    winRate,
    finetuned: ftMetrics ? {
      count: ftMetrics.count,
      placementVariety: ftMetrics.placementVariety,
      strategicAccuracy: ftMetrics.strategicAccuracy,
      manaEfficiency: ftMetrics.manaEfficiency,
      actionValidity: ftMetrics.actionValidity,
      heatmap: ftMetrics.placementHeatmap.grid
    } : null,
    base: baseMetrics ? {
      count: baseMetrics.count,
      placementVariety: baseMetrics.placementVariety,
      strategicAccuracy: baseMetrics.strategicAccuracy,
      manaEfficiency: baseMetrics.manaEfficiency,
      actionValidity: baseMetrics.actionValidity,
      heatmap: baseMetrics.placementHeatmap.grid
    } : null
  };

  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Results written to: ${outputFile}`);
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

main();
