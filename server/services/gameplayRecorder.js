const fs = require("fs");
const path = require("path");

const RECORDED_GAMEPLAY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "evaluation",
  "recorded-gameplay.jsonl"
);

function appendGameplayEntries(entries, logger = console) {
  if (!Array.isArray(entries) || entries.length === 0) {
    const err = new Error('Request body must include a non-empty "entries" array.');
    err.statusCode = 400;
    throw err;
  }

  const dir = path.dirname(RECORDED_GAMEPLAY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";
  fs.appendFileSync(RECORDED_GAMEPLAY_PATH, lines);

  logger.log(
    `[record-gameplay] Appended ${entries.length} entries to ${RECORDED_GAMEPLAY_PATH}`
  );

  return { success: true, count: entries.length };
}

module.exports = {
  appendGameplayEntries
};
