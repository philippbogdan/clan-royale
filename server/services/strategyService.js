const {
  WANDB_BASE_MODEL_ID,
  WANDB_FT_MODEL_ID
} = require("../constants");
const {
  STRATEGY_SYSTEM_PROMPT,
  RETRY_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT
} = require("../prompts");
const { buildFallbackResponse, validateStrategyResponse } = require("../strategyValidator");
const { callMistral, callQwen } = require("../modelClients");

function createServerError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function formatHand(hand = []) {
  return hand.map(card => `${card.name}(${card.cost})`).join(", ");
}

function createStrategyService({ clients, env = process.env, logger = console }) {
  async function getStrategy({ gameState, playerCommand, connectorModel }) {
    logger.log(`  connector: ${connectorModel || "mistral (default)"}`);
    logger.log(`  command: "${playerCommand}"`);
    logger.log(`  mana: ${gameState.mana}, hand: [${formatHand(gameState.hand || [])}]`);
    logger.log(`  myTroops: ${JSON.stringify(gameState.myTroops)}`);
    logger.log(`  opponentTroops: ${JSON.stringify(gameState.opponentTroops)}`);
    logger.log(`  myTowers: ${JSON.stringify(gameState.myTowers)}`);
    logger.log(`  opponentTowers: ${JSON.stringify(gameState.opponentTowers)}`);

    const isQwenConnector =
      connectorModel === "qwen-base" || connectorModel === "qwen-finetuned";

    if (isQwenConnector) {
      const modelId =
        connectorModel === "qwen-finetuned"
          ? WANDB_FT_MODEL_ID
          : WANDB_BASE_MODEL_ID;
      logger.log(`  Using Qwen: ${modelId}`);

      try {
        const data = await callQwen({
          wandb: clients.wandb,
          systemPrompt: STRATEGY_SYSTEM_PROMPT,
          gameState,
          command: playerCommand,
          modelId
        });

        logger.log(`  [Qwen] raw: ${JSON.stringify(data)}`);
        const validationError = validateStrategyResponse(data);
        if (validationError) {
          logger.log(`  [Qwen] validation error: ${validationError} — using fallback`);
          return buildFallbackResponse(gameState);
        }
        return data;
      } catch (err) {
        logger.error(`  [Qwen] Error: ${err.message} — using FALLBACK`);
        return buildFallbackResponse(gameState);
      }
    }

    if (!env.MISTRAL_API_KEY) {
      throw createServerError("MISTRAL_API_KEY is not configured on the server.");
    }

    let data;
    let validationError;

    try {
      data = await callMistral({
        mistral: clients.mistral,
        systemPrompt: STRATEGY_SYSTEM_PROMPT,
        gameState,
        playerCommand
      });
      logger.log(`  Mistral raw response: ${JSON.stringify(data)}`);
      validationError = validateStrategyResponse(data);
      if (validationError) {
        logger.log(`  Validation error: ${validationError}`);
        logger.log("  Retrying with simplified prompt...");

        data = await callMistral({
          mistral: clients.mistral,
          systemPrompt: RETRY_SYSTEM_PROMPT,
          gameState,
          playerCommand
        });

        logger.log(`  Retry response: ${JSON.stringify(data)}`);
        validationError = validateStrategyResponse(data);
        if (validationError) {
          logger.log(`  Retry validation error: ${validationError}`);
        }
      }
    } catch (err) {
      const errMsg =
        err.name === "AbortError"
          ? "Mistral API request timed out (10s)"
          : err.message;
      logger.error(`  Mistral API error: ${errMsg} — using FALLBACK`);
      const fallback = buildFallbackResponse(gameState);
      logger.log(`  Fallback → ${JSON.stringify(fallback.actions)}`);
      return fallback;
    }

    if (validationError) {
      logger.error(
        `  Validation failed after retry: ${validationError} — using FALLBACK`
      );
      return buildFallbackResponse(gameState);
    }

    return data;
  }

  async function runAiTurn({ gameState, modelType, side }) {
    logger.log(`  modelType: ${modelType || "base"}, side: ${side || "player"}`);
    logger.log(`  mana: ${gameState.mana}, hand: [${formatHand(gameState.hand || [])}]`);
    logger.log(`  myTroops: ${JSON.stringify(gameState.myTroops)}`);
    logger.log(`  opponentTroops: ${JSON.stringify(gameState.opponentTroops)}`);
    logger.log(`  myTowers: ${JSON.stringify(gameState.myTowers)}`);
    logger.log(`  opponentTowers: ${JSON.stringify(gameState.opponentTowers)}`);

    let orchestratorResult;
    const orchStart = Date.now();

    try {
      if (!env.XAI_API_KEY) {
        throw new Error("XAI_API_KEY not configured");
      }

      const orchResponse = await clients.grok.chat.completions.create({
        model: "grok-4-1-fast-non-reasoning",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ORCHESTRATOR_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ gameState }) }
        ]
      });

      orchestratorResult = JSON.parse(orchResponse.choices[0].message.content);
      logger.log(`  [Orchestrator] strategy: "${orchestratorResult.strategy}"`);
      logger.log(`  [Orchestrator] reasoning: "${orchestratorResult.reasoning}"`);
    } catch (err) {
      logger.error(`  [Orchestrator] Error: ${err.message} — using fallback strategy`);
      orchestratorResult = {
        strategy: "Play your cheapest available card defensively",
        reasoning: "Orchestrator unavailable, defaulting to conservative play."
      };
    }

    const orchLatency = Date.now() - orchStart;
    logger.log(`  [Orchestrator] latency: ${orchLatency}ms`);

    const qwenModelId = modelType === "finetuned" ? WANDB_FT_MODEL_ID : WANDB_BASE_MODEL_ID;
    const connectorModelLabel = `wandb:${qwenModelId}`;

    const connStart = Date.now();
    let connectorResult;
    let validationError;

    try {
      connectorResult = await callQwen({
        wandb: clients.wandb,
        systemPrompt: STRATEGY_SYSTEM_PROMPT,
        gameState,
        command: orchestratorResult.strategy,
        modelId: qwenModelId
      });
      logger.log(`  [Connector] raw: ${JSON.stringify(connectorResult)}`);
      validationError = validateStrategyResponse(connectorResult);
    } catch (err) {
      logger.error(`  [Connector] Error: ${err.message} — using fallback`);
      connectorResult = buildFallbackResponse(gameState);
      validationError = null;
    }

    if (validationError) {
      logger.error(`  [Connector] Validation failed: ${validationError} — using fallback`);
      connectorResult = buildFallbackResponse(gameState);
    }

    const connLatency = Date.now() - connStart;
    logger.log(`  [Connector] model: ${connectorModelLabel}, latency: ${connLatency}ms`);
    logger.log(`  [Connector] actions: ${JSON.stringify(connectorResult.actions)}`);

    return {
      orchestrator: {
        model: "grok-4-1-fast-non-reasoning",
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
  }

  return {
    getStrategy,
    runAiTurn
  };
}

module.exports = {
  createStrategyService
};
