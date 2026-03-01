const { VALID_LANES, VALID_TROOPS } = require("./constants");

function validateStrategyResponse(data) {
  if (!data || typeof data !== "object") {
    return "Response is not a JSON object";
  }
  if (!Array.isArray(data.actions)) {
    return 'Missing or invalid "actions" array';
  }
  if (typeof data.reasoning !== "string") {
    return 'Missing or invalid "reasoning" string';
  }

  for (let i = 0; i < data.actions.length; i += 1) {
    const action = data.actions[i];
    if (action.type !== "play_card") {
      return `actions[${i}].type must be "play_card"`;
    }
    if (!VALID_TROOPS.includes(action.card)) {
      return `actions[${i}].card "${action.card}" is not a valid troop`;
    }

    if (action.col != null || action.row != null) {
      if (!Number.isInteger(action.col) || action.col < 0 || action.col > 9) {
        return `actions[${i}].col must be integer 0-9`;
      }
      if (!Number.isInteger(action.row) || action.row < 0 || action.row > 5) {
        return `actions[${i}].row must be integer 0-5`;
      }
    } else if (!VALID_LANES.includes(action.lane)) {
      return `actions[${i}] must have col/row or valid lane`;
    }
  }

  return null;
}

function buildFallbackResponse(gameState) {
  if (!gameState || !Array.isArray(gameState.hand) || gameState.hand.length === 0) {
    return { actions: [], reasoning: "No cards in hand, waiting.", urgency: "low" };
  }

  const affordable = gameState.hand
    .filter(card => card.cost <= gameState.mana)
    .sort((a, b) => a.cost - b.cost);

  if (affordable.length === 0) {
    return {
      actions: [],
      reasoning: "Not enough mana for any card, waiting.",
      urgency: "low"
    };
  }

  const cheapest = affordable[0];
  return {
    actions: [{ type: "play_card", card: cheapest.name, col: 2, row: 4 }],
    reasoning: `Fallback: playing cheapest affordable card (${cheapest.name}).`,
    urgency: "medium"
  };
}

module.exports = {
  validateStrategyResponse,
  buildFallbackResponse
};
