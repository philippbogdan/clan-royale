// run-match.js — Headless Playwright match simulation for evaluating base vs fine-tuned models
//
// Runs real games in headless Chromium browsers. Each browser navigates to the game,
// enters AI vs AI spectator mode, and records decision logs.
//
// Usage: node evaluation/run-match.js --matches 100 --parallel 10 --output evaluation/logs/ [--url http://localhost:1234]

const fs = require("fs");
const path = require("path");

// Try playwright, fall back to @playwright/test
let chromium;
try {
  chromium = require("playwright").chromium;
} catch {
  chromium = require("@playwright/test").chromium;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const args = process.argv.slice(2);
const TOTAL_MATCHES = parseInt(getArg(args, "--matches") || "100", 10);
const PARALLEL = parseInt(getArg(args, "--parallel") || "10", 10);
const OUTPUT_DIR = getArg(args, "--output") || path.join(__dirname, "logs");
const GAME_URL = getArg(args, "--url") || "http://localhost:1234";
const GAME_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per game
const POLL_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Single match runner
// ---------------------------------------------------------------------------
async function runMatch(browser, matchIndex, modelType) {
  const matchId = `match-${String(matchIndex).padStart(3, "0")}-${modelType}`;
  const startTime = Date.now();
  let context;
  let page;

  try {
    context = await browser.newContext();
    page = await context.newPage();

    // Navigate and wait for page to fully load
    await page.goto(GAME_URL, { waitUntil: "networkidle", timeout: 30000 });

    // Set spectator mode and model type before starting the game
    await page.evaluate((mt) => {
      window.gameMode = "spectator";
      window.__modelType = mt;
    }, modelType);

    // Click the "AI vs AI" button to start the game
    // Wait for the button to appear, then click it
    const aiButton = await page.waitForSelector(
      'text="AI vs AI"',
      { timeout: 15000 }
    ).catch(() => null);

    if (!aiButton) {
      // Try alternative selectors
      const altButton = await page.waitForSelector(
        '[data-action="ai-vs-ai"], button:has-text("AI"), .ai-battle-btn',
        { timeout: 5000 }
      ).catch(() => null);

      if (altButton) {
        await altButton.click();
      } else {
        // Last resort: try clicking on the canvas and dispatching
        await page.click("canvas", { position: { x: 400, y: 300 } });
      }
    } else {
      await aiButton.click();
    }

    // Wait for game API to be ready
    const apiReady = await page.waitForFunction(
      () => !!window.__gameAPI,
      { timeout: 30000, polling: 500 }
    ).catch(() => null);

    if (!apiReady) {
      throw new Error("Game API did not become available within 30s");
    }

    // Poll for game completion
    let gameStatus = "playing";
    let turns = 0;
    const pollStart = Date.now();

    while (Date.now() - pollStart < GAME_TIMEOUT_MS) {
      const status = await page.evaluate(() => {
        const api = window.__gameAPI;
        if (!api) return { status: "waiting", turns: 0 };
        return {
          status: api.gameStatus || "playing",
          turns: api._recordedDecisions ? api._recordedDecisions.length : 0,
        };
      });

      gameStatus = status.status;
      turns = status.turns;

      if (gameStatus === "won" || gameStatus === "lost") {
        break;
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    // If timed out, treat as a loss
    if (gameStatus !== "won" && gameStatus !== "lost") {
      gameStatus = "timeout";
    }

    // Collect decision log
    const decisions = await page.evaluate(() => {
      return window.__gameAPI ? window.__gameAPI._recordedDecisions || [] : [];
    });

    const elapsed = Date.now() - startTime;
    const won = gameStatus === "won";

    // Write per-game JSONL log
    const logFile = path.join(OUTPUT_DIR, `${matchId}.jsonl`);
    const logStream = fs.createWriteStream(logFile);
    for (const decision of decisions) {
      logStream.write(
        JSON.stringify({
          ...decision,
          matchId,
          modelType,
        }) + "\n"
      );
    }
    logStream.end();

    return {
      matchId,
      modelType,
      won,
      gameStatus,
      turns,
      decisions: decisions.length,
      elapsedMs: elapsed,
    };
  } catch (err) {
    return {
      matchId,
      modelType,
      won: false,
      gameStatus: "error",
      turns: 0,
      decisions: 0,
      elapsedMs: Date.now() - startTime,
      error: err.message,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Retry wrapper — retry failed matches once
// ---------------------------------------------------------------------------
async function runMatchWithRetry(browser, matchIndex, modelType) {
  let result = await runMatch(browser, matchIndex, modelType);

  if (result.gameStatus === "error" || result.gameStatus === "timeout") {
    console.log(
      `  Retrying match ${matchIndex + 1} (${modelType}) after ${result.gameStatus}: ${result.error || "timeout"}`
    );
    result = await runMatch(browser, matchIndex, modelType);
    if (result.gameStatus === "error" || result.gameStatus === "timeout") {
      console.log(
        `  Match ${matchIndex + 1} failed again: ${result.error || result.gameStatus}`
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function main() {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Clan Royale — Headless Match Simulation`);
  console.log(`========================================`);
  console.log(`Total matches:  ${TOTAL_MATCHES}`);
  console.log(`Parallel:       ${PARALLEL}`);
  console.log(`Game URL:       ${GAME_URL}`);
  console.log(`Output:         ${OUTPUT_DIR}`);
  console.log(`Model split:    first ${Math.ceil(TOTAL_MATCHES / 2)} base, rest finetuned`);
  console.log();

  // Launch browser pool
  const browsers = [];
  for (let i = 0; i < PARALLEL; i++) {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    browsers.push(browser);
  }

  const results = [];
  const batchSize = PARALLEL;
  const totalBatches = Math.ceil(TOTAL_MATCHES / batchSize);

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, TOTAL_MATCHES);
    const batchCount = batchEnd - batchStart;

    const promises = Array.from({ length: batchCount }, (_, i) => {
      const matchIndex = batchStart + i;
      const modelType = matchIndex < Math.ceil(TOTAL_MATCHES / 2) ? "base" : "finetuned";
      const browserIdx = i % browsers.length;
      return runMatchWithRetry(browsers[browserIdx], matchIndex, modelType);
    });

    const batchResults = await Promise.allSettled(promises);

    for (const settled of batchResults) {
      const result =
        settled.status === "fulfilled"
          ? settled.value
          : {
              matchId: "unknown",
              modelType: "unknown",
              won: false,
              gameStatus: "rejected",
              turns: 0,
              decisions: 0,
              elapsedMs: 0,
              error: settled.reason?.message || "Promise rejected",
            };

      results.push(result);

      const statusIcon = result.won ? "WIN" : result.gameStatus === "lost" ? "LOSS" : result.gameStatus.toUpperCase();
      console.log(
        `  Match ${results.length}/${TOTAL_MATCHES}: ${statusIcon} (${result.modelType}) - ${result.turns} turns, ${result.decisions} decisions` +
          (result.error ? ` [${result.error}]` : "") +
          ` (${(result.elapsedMs / 1000).toFixed(1)}s)`
      );
    }
  }

  // Close all browsers
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));

  // Compute summaries
  const baseResults = results.filter((r) => r.modelType === "base");
  const finetunedResults = results.filter((r) => r.modelType === "finetuned");

  const baseWins = baseResults.filter((r) => r.won).length;
  const finetunedWins = finetunedResults.filter((r) => r.won).length;
  const baseErrors = baseResults.filter((r) => r.gameStatus === "error" || r.gameStatus === "timeout").length;
  const finetunedErrors = finetunedResults.filter((r) => r.gameStatus === "error" || r.gameStatus === "timeout").length;

  const summary = {
    timestamp: new Date().toISOString(),
    totalMatches: TOTAL_MATCHES,
    parallel: PARALLEL,
    gameUrl: GAME_URL,
    base: {
      matches: baseResults.length,
      wins: baseWins,
      losses: baseResults.length - baseWins,
      winRate: baseResults.length > 0 ? baseWins / baseResults.length : 0,
      errors: baseErrors,
      avgTurns:
        baseResults.length > 0
          ? baseResults.reduce((s, r) => s + r.turns, 0) / baseResults.length
          : 0,
      avgDecisions:
        baseResults.length > 0
          ? baseResults.reduce((s, r) => s + r.decisions, 0) / baseResults.length
          : 0,
      avgElapsedMs:
        baseResults.length > 0
          ? baseResults.reduce((s, r) => s + r.elapsedMs, 0) / baseResults.length
          : 0,
    },
    finetuned: {
      matches: finetunedResults.length,
      wins: finetunedWins,
      losses: finetunedResults.length - finetunedWins,
      winRate: finetunedResults.length > 0 ? finetunedWins / finetunedResults.length : 0,
      errors: finetunedErrors,
      avgTurns:
        finetunedResults.length > 0
          ? finetunedResults.reduce((s, r) => s + r.turns, 0) / finetunedResults.length
          : 0,
      avgDecisions:
        finetunedResults.length > 0
          ? finetunedResults.reduce((s, r) => s + r.decisions, 0) / finetunedResults.length
          : 0,
      avgElapsedMs:
        finetunedResults.length > 0
          ? finetunedResults.reduce((s, r) => s + r.elapsedMs, 0) / finetunedResults.length
          : 0,
    },
    allMatches: results.map((r) => ({
      matchId: r.matchId,
      modelType: r.modelType,
      won: r.won,
      gameStatus: r.gameStatus,
      turns: r.turns,
      decisions: r.decisions,
      elapsedMs: r.elapsedMs,
      error: r.error || null,
    })),
  };

  // Write summary
  const summaryFile = path.join(OUTPUT_DIR, "summary.json");
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  // Print final report
  console.log();
  console.log("========================================");
  console.log("           SIMULATION RESULTS           ");
  console.log("========================================");
  console.log();
  console.log(`Base model:`);
  console.log(`  Matches:    ${baseResults.length}`);
  console.log(`  Win rate:   ${(summary.base.winRate * 100).toFixed(1)}% (${baseWins}/${baseResults.length})`);
  console.log(`  Errors:     ${baseErrors}`);
  console.log(`  Avg turns:  ${summary.base.avgTurns.toFixed(1)}`);
  console.log(`  Avg time:   ${(summary.base.avgElapsedMs / 1000).toFixed(1)}s`);
  console.log();
  console.log(`Fine-tuned model:`);
  console.log(`  Matches:    ${finetunedResults.length}`);
  console.log(`  Win rate:   ${(summary.finetuned.winRate * 100).toFixed(1)}% (${finetunedWins}/${finetunedResults.length})`);
  console.log(`  Errors:     ${finetunedErrors}`);
  console.log(`  Avg turns:  ${summary.finetuned.avgTurns.toFixed(1)}`);
  console.log(`  Avg time:   ${(summary.finetuned.avgElapsedMs / 1000).toFixed(1)}s`);
  console.log();
  console.log(`Summary: ${summaryFile}`);
  console.log(`Logs:    ${OUTPUT_DIR}/match-*.jsonl`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
