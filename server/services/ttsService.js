async function streamTtsFromElevenLabs({
  text,
  apiKey,
  voiceId = "JBFqnCBsd6RMkjVDRZzb",
  response
}) {
  if (!text) {
    const err = new Error('Request body must include "text".');
    err.statusCode = 400;
    throw err;
  }

  if (!apiKey) {
    const err = new Error("ELEVENLABS_API_KEY not configured");
    err.statusCode = 500;
    throw err;
  }

  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.2 }
      })
    }
  );

  if (!ttsRes.ok) {
    throw new Error(`ElevenLabs TTS error: ${ttsRes.status} ${ttsRes.statusText}`);
  }

  response.set("Content-Type", "audio/mpeg");
  const reader = ttsRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(value);
  }
  response.end();
}

module.exports = {
  streamTtsFromElevenLabs
};
