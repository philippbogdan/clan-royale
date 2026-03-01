require("dotenv").config();

const cors = require("cors");
const express = require("express");

const {
  DEFAULT_CLIENT_ORIGIN,
  DEFAULT_SERVER_PORT
} = require("./constants");
const { attachDeepgramProxy } = require("./deepgramProxy");
const { createModelClients } = require("./modelClients");
const { createApiRouter } = require("./routes/api");

const app = express();
const clients = createModelClients(process.env);

if (!process.env.MISTRAL_API_KEY) {
  console.error(
    "MISTRAL_API_KEY is not set. The /api/strategy endpoint will return 500."
  );
}

app.use(cors({ origin: DEFAULT_CLIENT_ORIGIN }));
app.use(express.json());

app.use("/api", createApiRouter({ clients, env: process.env, logger: console }));

const server = app.listen(DEFAULT_SERVER_PORT, () => {
  console.log(`Server running on http://localhost:${DEFAULT_SERVER_PORT}`);
});

attachDeepgramProxy(server, {
  getApiKey: () => process.env.DEEPGRAM_API_KEY,
  logger: console
});
