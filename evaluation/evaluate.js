// evaluate.js — Metrics computation for base vs fine-tuned Mistral comparison
//
// Parses JSONL decision logs produced by run-match.js (Playwright), computes
// grid-aware metrics, and outputs a comparison summary + results.json.
//
// Expected JSONL entry format (one per decision):
//   { timestamp, side, gameState: { mana, hand, myTroops, opponentTroops, myTowers, opponentTowers, grid, ... },
//     actions: [{ type, card, col, row }], gameResult?: "won"|"lost" }
//
// Usage: node evaluation/evaluate.js --logs evaluation/logs/ --output evaluation/results.json

const fs = require("fs");
const path = require("path");

const GRID_COLS = 10;
const GRID_ROWS = 6;

// ---------------------------------------------------------------------------
// JSONL parsing — reads all .jsonl files matching a pattern in a directory
// ---------------------------------------------------------------------------

function readAllLogs(logsDir, prefix) {
  if (!fs.existsSync(logsDir)) {
    console.error(`Logs directory not found: ${logsDir}`);
    return [];
  }

  const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl") && f.includes(prefix));
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
// Metric: Win rate
// ---------------------------------------------------------------------------

function computeWinRate(entries) {
  // Group by match file (entries from the same file share a contiguous timestamp range)
  // Use gameResult field from flushed entries
  const matchResults = new Map();

  for (const entry of entries) {
    // Each entry may have a matchId from run-match, or we group by file
    const matchKey = entry.matchId || `match-${Math.floor(entry.timestamp / 300000)}`; // 5min buckets as fallback
    if (!matchResults.has(matchKey)) {
      matchResults.set(matchKey, { decisions: 0, lastResult: null, side: entry.side });
    }
    const m = matchResults.get(matchKey);
    m.decisions++;
    if (entry.gameResult) m.lastResult = entry.gameResult;
  }

  let wins = 0;
  let losses = 0;
  let unknown = 0;

  for (const [, m] of matchResults) {
    if (m.lastResult === "won") wins++;
    else if (m.lastResult === "lost") losses++;
    else unknown++;
  }

  const total = wins + losses;
  return { wins, losses, unknown, total: matchResults.size, winRate: total > 0 ? wins / total : 0 };
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

    // Check if any of our towers is low health (below 300)
    const myTowers = gs.myTowers || [];
    const hasLowTower = myTowers.some(t => t.health > 0 && t.health < 300);

    if (hasLowTower) {
      towerLowSituations++;
      // Defensive = placed in rows 3-5 (near own side)
      const defensiveActions = actions.filter(a => a.row != null && a.row >= 3);
      if (defensiveActions.length > 0) {
        defensiveWhenTowerLow++;
      }
    }

    // Check if mana is full (>= 9)
    if (gs.mana >= 9) {
      manaFullSituations++;
      // Offensive = placed in rows 0-2 (near enemy side)
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

  // Card catalog for cost lookups
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
// Metric: Average decision latency
// ---------------------------------------------------------------------------

function computeLatency(entries) {
  if (entries.length < 2) return { avgMs: 0, medianMs: 0 };

  // Sort by timestamp, compute gaps between consecutive decisions
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (gap > 0 && gap < 30000) { // ignore gaps > 30s (likely between matches)
      gaps.push(gap);
    }
  }

  if (gaps.length === 0) return { avgMs: 0, medianMs: 0 };

  gaps.sort((a, b) => a - b);
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const median = gaps[Math.floor(gaps.length / 2)];

  return { avgMs: Math.round(avg), medianMs: median };
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
  let hasLaneField = 0;

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

      // Check col/row bounds
      if (action.col == null || action.row == null ||
          action.col < 0 || action.col > 9 || action.row < 0 || action.row > 5) {
        outOfBounds++;
        valid = false;
      }

      // Check if card is in hand
      const hand = gs.hand || [];
      const inHand = hand.some(c => c.name && c.name.toLowerCase() === (action.card || "").toLowerCase());
      if (!inHand) {
        cardNotInHand++;
        valid = false;
      }

      // Check mana
      const cost = CARD_COSTS[action.card] || 0;
      if (cost > manaLeft) {
        notEnoughMana++;
        valid = false;
      } else {
        manaLeft -= cost;
      }

      // Check for legacy lane field
      if (action.lane !== undefined) {
        hasLaneField++;
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
    notEnoughMana,
    hasLaneField
  };
}

// ---------------------------------------------------------------------------
// Aggregate all metrics
// ---------------------------------------------------------------------------

function computeAllMetrics(entries) {
  return {
    count: entries.length,
    winRate: computeWinRate(entries),
    placementVariety: computePlacementVariety(entries),
    placementHeatmap: computePlacementHeatmap(entries),
    strategicAccuracy: computeStrategicAccuracy(entries),
    manaEfficiency: computeManaEfficiency(entries),
    latency: computeLatency(entries),
    actionValidity: computeActionValidity(entries)
  };
}

// ---------------------------------------------------------------------------
// Pretty-print comparison table
// ---------------------------------------------------------------------------

function fmtPct(v) { return (v * 100).toFixed(1) + "%"; }
function fmtDelta(v) { const s = (v * 100).toFixed(1); return (v >= 0 ? "+" : "") + s + "%"; }
function fmtNum(v) { return String(v); }
function fmtMs(v) { return v + "ms"; }

function printComparisonTable(base, ft) {
  const W = 72;
  console.log("\n" + "=".repeat(W));
  console.log("  EVALUATION: Base Mistral vs Fine-tuned Mistral");
  console.log("=".repeat(W));
  console.log();

  const header = "Metric".padEnd(28) + "Base".padEnd(14) + "Fine-tuned".padEnd(14) + "Delta";
  console.log(header);
  console.log("-".repeat(W));

  const rows = [
    ["Win Rate", fmtPct(base.winRate.winRate), fmtPct(ft.winRate.winRate), fmtDelta(ft.winRate.winRate - base.winRate.winRate)],
    ["Placement Variety", base.placementVariety.variety, ft.placementVariety.variety, fmtDelta((ft.placementVariety.uniqueCells - base.placementVariety.uniqueCells) / 60)],
    ["Action Validity", fmtPct(base.actionValidity.validityRate), fmtPct(ft.actionValidity.validityRate), fmtDelta(ft.actionValidity.validityRate - base.actionValidity.validityRate)],
    ["Mana Efficiency", fmtPct(base.manaEfficiency.efficiency), fmtPct(ft.manaEfficiency.efficiency), fmtDelta(ft.manaEfficiency.efficiency - base.manaEfficiency.efficiency)],
    ["Defensive When Low HP", fmtPct(base.strategicAccuracy.defensiveRate), fmtPct(ft.strategicAccuracy.defensiveRate), fmtDelta(ft.strategicAccuracy.defensiveRate - base.strategicAccuracy.defensiveRate)],
    ["Offensive When Full Mana", fmtPct(base.strategicAccuracy.offensiveRate), fmtPct(ft.strategicAccuracy.offensiveRate), fmtDelta(ft.strategicAccuracy.offensiveRate - base.strategicAccuracy.offensiveRate)],
    ["Avg Decision Gap", fmtMs(base.latency.avgMs), fmtMs(ft.latency.avgMs), fmtMs(ft.latency.avgMs - base.latency.avgMs)],
    ["Legacy Lane Fields", fmtNum(base.actionValidity.hasLaneField), fmtNum(ft.actionValidity.hasLaneField), ""],
    ["Total Decisions", fmtNum(base.count), fmtNum(ft.count), ""],
    ["Total Actions", fmtNum(base.actionValidity.totalActions), fmtNum(ft.actionValidity.totalActions), ""],
  ];

  for (const [label, bv, fv, dv] of rows) {
    console.log(label.padEnd(28) + bv.padEnd(14) + fv.padEnd(14) + dv);
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

function printSingleModelMetrics(label, m) {
  console.log(`--- ${label} Model Metrics ---`);
  console.log(`  Decisions:            ${m.count}`);
  console.log(`  Win Rate:             ${fmtPct(m.winRate.winRate)} (${m.winRate.wins}W / ${m.winRate.losses}L / ${m.winRate.unknown} unknown)`);
  console.log(`  Placement Variety:    ${m.placementVariety.variety} unique cells`);
  console.log(`  Action Validity:      ${fmtPct(m.actionValidity.validityRate)} (${m.actionValidity.validActions}/${m.actionValidity.totalActions})`);
  console.log(`  Mana Efficiency:      ${fmtPct(m.manaEfficiency.efficiency)}`);
  console.log(`  Defensive (low HP):   ${fmtPct(m.strategicAccuracy.defensiveRate)} (${m.strategicAccuracy.defensiveWhenTowerLow}/${m.strategicAccuracy.towerLowSituations})`);
  console.log(`  Offensive (full mana):${fmtPct(m.strategicAccuracy.offensiveRate)} (${m.strategicAccuracy.offensiveWhenManaFull}/${m.strategicAccuracy.manaFullSituations})`);
  console.log(`  Avg Decision Gap:     ${fmtMs(m.latency.avgMs)}`);
  console.log(`  Out-of-Bounds:        ${m.actionValidity.outOfBounds}`);
  console.log(`  Card Not In Hand:     ${m.actionValidity.cardNotInHand}`);
  console.log(`  Not Enough Mana:      ${m.actionValidity.notEnoughMana}`);
  console.log(`  Legacy Lane Fields:   ${m.actionValidity.hasLaneField}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const logsDir = getArg(args, "--logs") || path.join(__dirname, "logs");
  const outputFile = getArg(args, "--output") || path.join(__dirname, "results.json");

  // Read log files — base and finetuned
  const baseEntries = readAllLogs(logsDir, "base");
  const ftEntries = readAllLogs(logsDir, "finetuned");

  console.log(`Loaded ${baseEntries.length} base entries from ${logsDir}`);
  console.log(`Loaded ${ftEntries.length} fine-tuned entries from ${logsDir}`);

  if (baseEntries.length === 0 && ftEntries.length === 0) {
    console.error("\nNo log files found. Run matches first:");
    console.error("  node evaluation/run-match.js --matches 100 --parallel 10 --output evaluation/logs/");
    process.exit(1);
  }

  // Compute metrics
  const baseMetrics = baseEntries.length > 0 ? computeAllMetrics(baseEntries) : null;
  const ftMetrics = ftEntries.length > 0 ? computeAllMetrics(ftEntries) : null;

  // Print results
  if (baseMetrics && ftMetrics) {
    printComparisonTable(baseMetrics, ftMetrics);
    printHeatmap("Base", baseMetrics.placementHeatmap);
    printHeatmap("Fine-tuned", ftMetrics.placementHeatmap);
  } else if (baseMetrics) {
    printSingleModelMetrics("Base", baseMetrics);
    printHeatmap("Base", baseMetrics.placementHeatmap);
  } else if (ftMetrics) {
    printSingleModelMetrics("Fine-tuned", ftMetrics);
    printHeatmap("Fine-tuned", ftMetrics.placementHeatmap);
  }

  // Write results.json
  const output = {
    timestamp: new Date().toISOString(),
    logsDir,
    base: baseMetrics ? {
      count: baseMetrics.count,
      winRate: baseMetrics.winRate,
      placementVariety: baseMetrics.placementVariety,
      strategicAccuracy: baseMetrics.strategicAccuracy,
      manaEfficiency: baseMetrics.manaEfficiency,
      latency: baseMetrics.latency,
      actionValidity: baseMetrics.actionValidity,
      heatmap: baseMetrics.placementHeatmap.grid
    } : null,
    finetuned: ftMetrics ? {
      count: ftMetrics.count,
      winRate: ftMetrics.winRate,
      placementVariety: ftMetrics.placementVariety,
      strategicAccuracy: ftMetrics.strategicAccuracy,
      manaEfficiency: ftMetrics.manaEfficiency,
      latency: ftMetrics.latency,
      actionValidity: ftMetrics.actionValidity,
      heatmap: ftMetrics.placementHeatmap.grid
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
