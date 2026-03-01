// fine-tune.js — Upload training data to Mistral and start fine-tuning
//
// Usage: node evaluation/fine-tune.js --input evaluation/training-data.jsonl [--model open-mistral-7b] [--steps 50] [--lr 0.0001]

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Mistral } = require("@mistralai/mistralai");

function getArg(args, flag, defaultValue) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = getArg(args, "--input", path.join(__dirname, "training-data.jsonl"));
  const steps = parseInt(getArg(args, "--steps", "50"), 10);
  const lr = parseFloat(getArg(args, "--lr", "0.0001"));
  const model = getArg(args, "--model", "open-mistral-7b");

  // Validate
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.error("ERROR: MISTRAL_API_KEY not set in environment or .env");
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: Training data file not found: ${inputFile}`);
    console.error("Run: node evaluation/generate-training-data.js --output evaluation/training-data.jsonl --count 500");
    process.exit(1);
  }

  const fileContent = fs.readFileSync(inputFile);
  const lineCount = fileContent.toString().trim().split("\n").length;
  console.log(`Training data: ${inputFile} (${lineCount} examples)`);
  console.log(`Model: ${model}`);
  console.log(`Hyperparameters: steps=${steps}, lr=${lr}`);
  console.log();

  const mistral = new Mistral({ apiKey });

  // Step 1: Upload training data
  console.log("Uploading training data to Mistral...");
  let uploadedFile;
  try {
    uploadedFile = await mistral.files.upload({
      file: {
        fileName: path.basename(inputFile),
        content: fileContent,
      },
    });
    console.log(`  File uploaded: id=${uploadedFile.id}`);
  } catch (err) {
    console.error("ERROR uploading file:", err.message || err);
    process.exit(1);
  }

  // Step 2: Create fine-tuning job
  console.log("\nCreating fine-tuning job...");
  let job;
  try {
    job = await mistral.fineTuning.jobs.create({
      model,
      trainingFiles: [{ fileId: uploadedFile.id, weight: 1 }],
      hyperparameters: {
        trainingSteps: steps,
        learningRate: lr,
      },
      autoStart: true,
    });
    console.log(`  Job created: id=${job.id}, status=${job.status}`);
  } catch (err) {
    console.error("ERROR creating fine-tuning job:", err.message || err);
    process.exit(1);
  }

  // Step 3: Poll for completion
  console.log("\nPolling for completion (every 30s)...");
  const startTime = Date.now();
  const maxWait = 60 * 60 * 1000; // 1 hour max

  while (true) {
    await sleep(30000);

    let status;
    try {
      status = await mistral.fineTuning.jobs.get({ jobId: job.id });
    } catch (err) {
      console.error(`  Poll error: ${err.message || err}`);
      continue;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [${elapsed}s] Status: ${status.status}`);

    if (status.status === "SUCCESS") {
      const modelId = status.fineTunedModel;
      console.log("\n========================================");
      console.log("  Fine-tuning complete!");
      console.log(`  Model ID: ${modelId}`);
      console.log("========================================");
      console.log(`\nAdd to .env: MISTRAL_FT_MODEL=${modelId}`);

      // Auto-append to .env if not already present
      const envPath = path.join(__dirname, "..", ".env");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        if (!envContent.includes("MISTRAL_FT_MODEL=")) {
          fs.appendFileSync(envPath, `\nMISTRAL_FT_MODEL=${modelId}\n`);
          console.log("  (Auto-appended to .env)");
        } else {
          console.log("  (MISTRAL_FT_MODEL already in .env — update manually if needed)");
        }
      }
      break;
    }

    if (status.status === "FAILED" || status.status === "CANCELLED") {
      console.error(`\nFine-tuning ${status.status.toLowerCase()}.`);
      if (status.message) console.error(`  Message: ${status.message}`);
      process.exit(1);
    }

    if (Date.now() - startTime > maxWait) {
      console.error("\nTimed out after 1 hour. Job is still running.");
      console.error(`  Check manually: job id = ${job.id}`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
