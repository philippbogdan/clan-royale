function cleanJsonLikeString(content) {
  return String(content || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

function parseJsonContent(content) {
  if (content && typeof content === "object") {
    return content;
  }
  const cleaned = cleanJsonLikeString(content);
  if (!cleaned) {
    throw new Error("Model response was empty");
  }
  return JSON.parse(cleaned);
}

function normalizeStrategyPayload(payload) {
  if (Array.isArray(payload)) {
    return { actions: payload, reasoning: "Deploying troops!", urgency: "medium" };
  }

  return {
    actions: Array.isArray(payload && payload.actions) ? payload.actions : [],
    reasoning: (payload && payload.reasoning) || "Deploying troops!",
    urgency: (payload && payload.urgency) || "medium"
  };
}

module.exports = {
  parseJsonContent,
  normalizeStrategyPayload
};
