// run-match.js — Headless Playwright match simulation for evaluating fine-tuned vs base Qwen
//
// Every match is HEAD-TO-HEAD:
//   Player side  = Grok orchestrator + Fine-tuned Qwen connector
//   Opponent side = Grok orchestrator + Base Qwen connector
//
// Win = fine-tuned (player) destroys base (opponent) king tower.
// Loss = base (opponent) destroys fine-tuned (player) king tower.
//
// Usage: node evaluation/run-match.js --matches 100 --parallel 5 --output evaluation/logs/

const fs = require("fs");
const path = require("path");

let chromium;
try {
  chromium = require("playwright").chromium;
} catch {
  chromium = require("@playwright/test").chromium;
}

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const args = process.argv.slice(2);
const TOTAL_MATCHES = parseInt(getArg(args, "--matches") || "100", 10);
const PARALLEL = parseInt(getArg(args, "--parallel") || "5", 10);
const OUTPUT_DIR = getArg(args, "--output") || path.join(__dirname, "logs");
const GAME_URL = getArg(args, "--url") || "http://localhost:1234";
const GAME_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per game max

// ---------------------------------------------------------------------------
// Single match runner — always head-to-head (finetuned vs base)
// ---------------------------------------------------------------------------
async function runMatch(browser, matchIndex) {
  const matchId = `match-${String(matchIndex).padStart(3, "0")}`;
  const startTime = Date.now();
  let context;

  try {
    context = await browser.newContext();
    const page = await context.newPage();

    // Suppress console noise
    page.on("pageerror", () => {});

    // Navigate
    await page.goto(GAME_URL, { waitUntil: "networkidle", timeout: 30000 });

    // Set spectator mode: player=finetuned, opponent=base
    await page.evaluate(() => {
      window.gameMode = "spectator";
      window.spectatorModelType = "finetuned";
    });

    // Click "FINE-TUNED vs BASE" button — head-to-head match
    const btn = await page.locator('button:has-text("FINE-TUNED vs BASE")').first();
    await btn.click({ timeout: 10000 });

    // Wait for gameAPI to be available (PlayScene created)
    await page.waitForFunction(() => !!window.gameAPI, { timeout: 30000, polling: 500 });

    // Poll for game completion
    let gameStatus = "playing";
    const pollStart = Date.now();

    while (Date.now() - pollStart < GAME_TIMEOUT_MS) {
      const status = await page.evaluate(() => {
        if (!window.gameAPI) return "playing";
        return window.gameAPI.gameStatus || "playing";
      });

      if (status === "won" || status === "lost") {
        gameStatus = status;
        break;
      }

      await page.waitForTimeout(2000);
    }

    if (gameStatus !== "won" && gameStatus !== "lost") {
      gameStatus = "timeout";
    }

    // Collect decision log (flushedDecisions has gameResult, falls back to live array)
    const gameData = await page.evaluate(() => {
      const api = window.gameAPI;
      if (!api) return { decisions: [] };
      const decisions = (api._flushedDecisions && api._flushedDecisions.length > 0)
        ? api._flushedDecisions
        : api._recordedDecisions || [];
      return { decisions };
    });

    const elapsed = Date.now() - startTime;
    // won = finetuned (player) beat base (opponent)
    const finetunedWon = gameStatus === "won";

    // Write per-game JSONL log
    const logFile = path.join(OUTPUT_DIR, `${matchId}.jsonl`);
    const lines = gameData.decisions.map((d) =>
      JSON.stringify({ ...d, matchId })
    );
    if (lines.length > 0) {
      fs.writeFileSync(logFile, lines.join("\n") + "\n");
    }

    return {
      matchId,
      finetunedWon,
      gameStatus,
      decisions: gameData.decisions.length,
      elapsedMs: elapsed,
    };
  } catch (err) {
    return {
      matchId,
      finetunedWon: false,
      gameStatus: "error",
      decisions: 0,
      elapsedMs: Date.now() - startTime,
      error: err.message,
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// Retry once on failure
async function runMatchWithRetry(browser, matchIndex) {
  let result = await runMatch(browser, matchIndex);
  if (result.gameStatus === "error" || result.gameStatus === "timeout") {
    console.log(`  ↻ Retry ${matchIndex + 1}: ${result.error || "timeout"}`);
    result = await runMatch(browser, matchIndex);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Clan Royale — Head-to-Head Match Simulation`);
  console.log(`============================================`);
  console.log(`  Fine-tuned Qwen (player) vs Base Qwen (opponent)`);
  console.log(`  Both sides orchestrated by Grok 4.1 Fast`);
  console.log(`Total matches:  ${TOTAL_MATCHES}`);
  console.log(`Parallel:       ${PARALLEL}`);
  console.log(`Game URL:       ${GAME_URL}`);
  console.log(`Output:         ${OUTPUT_DIR}`);
  console.log();

  // Launch browser pool
  const browsers = [];
  for (let i = 0; i < PARALLEL; i++) {
    browsers.push(
      await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
    );
  }

  const results = [];
  const totalBatches = Math.ceil(TOTAL_MATCHES / PARALLEL);

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * PARALLEL;
    const batchEnd = Math.min(batchStart + PARALLEL, TOTAL_MATCHES);

    const promises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const browserIdx = (i - batchStart) % browsers.length;
      promises.push(runMatchWithRetry(browsers[browserIdx], i));
    }

    const batchResults = await Promise.allSettled(promises);

    for (const settled of batchResults) {
      const result =
        settled.status === "fulfilled"
          ? settled.value
          : { matchId: "?", finetunedWon: false, gameStatus: "rejected", decisions: 0, elapsedMs: 0, error: settled.reason?.message };

      results.push(result);
      const icon = result.finetunedWon ? "✓ FT WIN" : result.gameStatus === "lost" ? "✗ BASE WIN" : result.gameStatus.toUpperCase();
      console.log(
        `  [${results.length}/${TOTAL_MATCHES}] ${icon}  ${result.decisions} decisions ${(result.elapsedMs / 1000).toFixed(0)}s` +
          (result.error ? ` [${result.error}]` : "")
      );
    }
  }

  // Close browsers
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));

  // Summary
  const ftWins = results.filter((r) => r.finetunedWon).length;
  const baseWins = results.filter((r) => r.gameStatus === "lost").length;
  const errors = results.filter((r) => r.gameStatus === "error" || r.gameStatus === "timeout").length;
  const completed = ftWins + baseWins;

  const summary = {
    timestamp: new Date().toISOString(),
    mode: "head-to-head",
    description: "Fine-tuned Qwen (player) vs Base Qwen (opponent), both orchestrated by Grok 4.1 Fast",
    totalMatches: TOTAL_MATCHES,
    completed,
    finetunedWins: ftWins,
    baseWins,
    errors,
    finetunedWinRate: completed > 0 ? ftWins / completed : 0,
    baseWinRate: completed > 0 ? baseWins / completed : 0,
    allMatches: results,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  console.log();
  console.log("============================================");
  console.log("      HEAD-TO-HEAD SIMULATION RESULTS       ");
  console.log("============================================");
  console.log(`  Fine-tuned wins: ${ftWins}/${completed} (${(summary.finetunedWinRate * 100).toFixed(1)}%)`);
  console.log(`  Base wins:       ${baseWins}/${completed} (${(summary.baseWinRate * 100).toFixed(1)}%)`);
  console.log(`  Errors/Timeouts: ${errors}`);
  console.log(`\nLogs: ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
