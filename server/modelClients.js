const { Mistral } = require("@mistralai/mistralai");
const OpenAI = require("openai");

const { MISTRAL_TIMEOUT_MS } = require("./constants");
const {
  normalizeStrategyPayload,
  parseJsonContent
} = require("./strategyParser");

function createModelClients(env = process.env) {
  return {
    mistral: new Mistral({ apiKey: env.MISTRAL_API_KEY || "" }),
    grok: new OpenAI({
      apiKey: env.XAI_API_KEY || "",
      baseURL: "https://api.x.ai/v1"
    }),
    wandb: env.WANDB_API_KEY
      ? new OpenAI({
          apiKey: env.WANDB_API_KEY,
          baseURL: "https://api.training.wandb.ai/v1/"
        })
      : null
  };
}

async function callMistral({
  mistral,
  systemPrompt,
  gameState,
  playerCommand,
  model = "mistral-small-latest"
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MISTRAL_TIMEOUT_MS);

  try {
    const result = await mistral.chat.complete(
      {
        model,
        responseFormat: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({ gameState, playerCommand })
          }
        ]
      },
      { fetchOptions: { signal: controller.signal } }
    );

    return parseJsonContent(result.choices[0].message.content);
  } finally {
    clearTimeout(timeout);
  }
}

async function callQwen({
  wandb,
  systemPrompt,
  gameState,
  command,
  modelId
}) {
  if (!wandb) {
    throw new Error("WANDB_API_KEY not configured");
  }

  const response = await wandb.chat.completions.create({
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({ gameState, playerCommand: command })
      }
    ],
    max_tokens: 300
  });

  const payload = parseJsonContent(response.choices[0].message.content);
  return normalizeStrategyPayload(payload);
}

module.exports = {
  createModelClients,
  callMistral,
  callQwen
};
