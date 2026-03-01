const VALID_TROOPS = [
  "AlienTroop",
  "BattleOtterTroop",
  "ChickphinTroop",
  "ClownGuyTroop",
  "ClownLadyTroop",
  "EvilTroop",
  "LilDemonTroop",
  "MamaCowTroop",
  "QuackerTroop",
  "TankTroop",
  "VolcanoTroop",
  "WitchTroop",
  "ZDogTroop"
];

const VALID_LANES = ["left", "right"];

const WANDB_FT_MODEL_ID =
  "wandb-artifact:///philbog/clan-royale/clan-royale-sft";
const WANDB_BASE_MODEL_ID =
  "wandb-artifact:///philbog/clan-royale/clan-royale-base";

const DEFAULT_SERVER_PORT = Number(process.env.PORT || 3001);
const DEFAULT_CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "http://localhost:1234";
const MISTRAL_TIMEOUT_MS = 10000;

module.exports = {
  VALID_TROOPS,
  VALID_LANES,
  WANDB_FT_MODEL_ID,
  WANDB_BASE_MODEL_ID,
  DEFAULT_SERVER_PORT,
  DEFAULT_CLIENT_ORIGIN,
  MISTRAL_TIMEOUT_MS
};
