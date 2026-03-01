const WebSocket = require("ws");

function attachDeepgramProxy(server, { getApiKey, logger = console }) {
  const resolveApiKey = typeof getApiKey === "function"
    ? getApiKey
    : () => process.env.DEEPGRAM_API_KEY;

  const wss = new WebSocket.Server({
    server,
    verifyClient: info => info.req.url.startsWith("/deepgram")
  });

  wss.on("connection", (clientWs, req) => {
    const dgKey = resolveApiKey();
    if (!dgKey) {
      clientWs.close(4001, "DEEPGRAM_API_KEY not configured");
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const encoding = url.searchParams.get("encoding");
    let dgUrl =
      "wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&endpointing=200&vad_events=true";
    if (encoding === "aac") {
      dgUrl += "&encoding=aac&sample_rate=48000";
    }

    logger.log(
      `[Deepgram] Connecting with encoding: ${encoding || "auto-detect"}`
    );

    const dgWs = new WebSocket(dgUrl, {
      headers: { Authorization: `Token ${dgKey}` }
    });

    dgWs.on("open", () => {
      logger.log("[Deepgram] Proxy connected");
    });

    dgWs.on("message", data => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString());
      }
    });

    clientWs.on("message", data => {
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(data);
      }
    });

    clientWs.on("close", () => {
      dgWs.close();
    });

    dgWs.on("close", (code, reason) => {
      logger.log(`[Deepgram] WS closed code=${code} reason=${reason}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    });

    dgWs.on("error", err => {
      logger.error(
        "[Deepgram] WebSocket error:",
        err.message,
        err.code || "",
        err.toString()
      );
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(4002, "Deepgram connection failed");
      }
    });
  });

  return wss;
}

module.exports = {
  attachDeepgramProxy
};
