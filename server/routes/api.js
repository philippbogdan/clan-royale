const express = require("express");

const { createStrategyService } = require("../services/strategyService");
const { appendGameplayEntries } = require("../services/gameplayRecorder");
const { streamTtsFromElevenLabs } = require("../services/ttsService");

function createApiRouter({ clients, env = process.env, logger = console }) {
  const router = express.Router();
  const strategyService = createStrategyService({ clients, env, logger });

  router.get("/config", (req, res) => {
    res.json({ agentId: env.ELEVENLABS_AGENT_ID || null });
  });

  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      mistralKeySet: !!env.MISTRAL_API_KEY,
      timestamp: new Date().toISOString()
    });
  });

  router.get("/conversation-token", async (req, res) => {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${env.ELEVENLABS_AGENT_ID}`,
        { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }
      );
      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/tts", async (req, res) => {
    try {
      await streamTtsFromElevenLabs({
        text: req.body.text,
        apiKey: env.ELEVENLABS_API_KEY,
        voiceId: env.ELEVENLABS_VOICE_ID,
        response: res
      });
    } catch (err) {
      logger.error("TTS proxy error:", err.message);
      res.status(err.statusCode || 500).json({ error: err.message || "TTS failed" });
    }
  });

  router.get("/deepgram-key", (req, res) => {
    if (!env.DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: "DEEPGRAM_API_KEY not configured" });
    }
    return res.json({ key: env.DEEPGRAM_API_KEY });
  });

  router.post("/strategy", async (req, res) => {
    const { gameState, playerCommand, connectorModel } = req.body;
    if (!gameState || !playerCommand) {
      return res.status(400).json({
        error: 'Request body must include "gameState" and "playerCommand".'
      });
    }

    const ts = new Date().toISOString();
    logger.log(`\n[${ts}] ═══ /api/strategy ═══`);

    try {
      const data = await strategyService.getStrategy({
        gameState,
        playerCommand,
        connectorModel
      });
      logger.log(`  ✓ FINAL: ${data.actions.length} action(s): ${JSON.stringify(data.actions)}`);
      logger.log(`  reasoning: "${data.reasoning}"`);
      return res.json(data);
    } catch (err) {
      logger.error("  /api/strategy error:", err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.post("/ai-turn", async (req, res) => {
    const { gameState, modelType, side } = req.body;
    if (!gameState) {
      return res
        .status(400)
        .json({ error: 'Request body must include "gameState".' });
    }

    const ts = new Date().toISOString();
    logger.log(`\n[${ts}] ═══ /api/ai-turn ═══`);

    try {
      const result = await strategyService.runAiTurn({ gameState, modelType, side });
      const total = result.orchestrator.latencyMs + result.connector.latencyMs;
      logger.log(`  ═══ /api/ai-turn complete (total ${total}ms) ═══\n`);
      return res.json(result);
    } catch (err) {
      logger.error("  /api/ai-turn error:", err.message);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.post("/record-gameplay", (req, res) => {
    try {
      const result = appendGameplayEntries(req.body.entries, logger);
      return res.json(result);
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createApiRouter
};
