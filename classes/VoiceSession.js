import { Conversation } from "@elevenlabs/client";

function debugLog(event, data) {
  if (typeof window === 'undefined') return;
  if (!window.__voiceDebugLog) window.__voiceDebugLog = [];
  var entry = { t: new Date().toISOString(), event: event, data: data || null };
  window.__voiceDebugLog.push(entry);
  console.log('[Voice]', entry.t, event, data || '');
}

function voiceLog(text, type) {
  if (typeof window !== 'undefined' && window.addVoiceLog) {
    window.addVoiceLog(text, type || 'system');
  }
}

const CONTEXTUAL_MESSAGES = {
  opponent_push: [
    "They're pushing {lane}!",
    "Incoming {lane} lane!",
    "Watch out — {lane} side attack!",
    "Here they come on the {lane}!",
  ],
  tower_damage: [
    "Our tower took a hit!",
    "Tower getting hammered!",
    "They're chipping our tower!",
    "Tower under fire!",
  ],
  mana_full: [
    "Mana maxed out — let's spend it!",
    "Full elixir, time to push!",
    "We're sitting on max mana, go go go!",
    "Elixir full — what are we waiting for?",
  ],
  low_health_tower: [
    "Tower critical! Defend NOW!",
    "We're about to lose a tower!",
    "Tower hanging on by a thread!",
    "DEFEND! Tower's almost gone!",
  ],
  game_over_win: [
    "GG EZ! We crushed them!",
    "VICTORY! That's what I'm talking about!",
    "Another W in the books!",
    "They never stood a chance!",
  ],
  game_over_lose: [
    "They got us this time... rematch?",
    "Tough loss. Let's go again!",
    "We'll get 'em next time!",
    "Oof, that one stings.",
  ],
};

const ERROR_MESSAGES = {
  mic_denied: "Microphone access denied. Check your browser settings.",
  connection_failed: "Couldn't connect to voice server. Try again in a moment.",
  timeout: "Voice server didn't respond. Try typing your command instead.",
  unknown: "Something went wrong. Try refreshing the page.",
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Module-level variable to track current TTS audio playback
let currentAudio = null;

/** Cancel any ongoing TTS and immediately unmute speech input */
function interruptTTS() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  window.__ttsSpeaking = false;
  if (window.__speechInput) {
    window.__speechInput.isMuted = false;
    window.__speechInput._lastUnmuteTime = 0; // skip cooldown — player is actively talking
  }
}

// Expose globally so SpeechInput can interrupt when player starts talking
if (typeof window !== 'undefined') {
  window.__interruptTTS = interruptTTS;
  window.__ttsSpeaking = false;
}

// ElevenLabs TTS via server proxy — mutes SpeechInput to prevent feedback
async function speakText(text) {
  if (typeof window === 'undefined') return;

  // Cancel any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  // Mute speech input to prevent feedback loop
  if (window.__speechInput) window.__speechInput.mute();

  try {
    const response = await fetch('http://localhost:3001/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error('TTS request failed: ' + response.status);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    window.__ttsSpeaking = true;

    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      window.__ttsSpeaking = false;
      // Unmute after delay — SpeechRecognition delivers results with 1-3s lag
      // Combined with SpeechInput's 2s post-unmute cooldown = ~5.5s total protection
      setTimeout(() => {
        if (window.__speechInput) window.__speechInput.unmute();
      }, 2000);
    });

    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      window.__ttsSpeaking = false;
      if (window.__speechInput) window.__speechInput.unmute();
    });

    await audio.play();
  } catch (err) {
    console.error('[VoiceSession] TTS playback failed:', err);
    currentAudio = null;
    if (window.__speechInput) window.__speechInput.unmute();
  }
}

// Expose globally so SpeechInput can use it for Mistral responses
if (typeof window !== 'undefined') {
  window.__speakText = speakText;
}

export default class VoiceSession {
  constructor(gameAPI) {
    this.gameAPI = gameAPI;
    this.conversation = null;
    this.status = "disconnected";
    this._agentId = null;
    this._reconnecting = false;
    this._reconnectAttempts = 0;

    // Event callbacks - assign externally
    this.onMessage = null;
    this.onModeChange = null;
    this.onStatusChange = null;
    this.onError = null;
  }

  async start(agentId) {
    if (agentId) this._agentId = agentId;

    debugLog("start", { agentId: this._agentId, textOnly: true });

    if (this.conversation) {
      await this.stop();
    }

    try {
      this.setStatus("connecting");
      voiceLog("Connecting to voice agent (text mode)...", "system");

      // Release any mic stream from landing page (not needed for text-only)
      if (window.__micStream) {
        window.__micStream.getTracks().forEach(t => t.stop());
        window.__micStream = null;
      }

      debugLog("session_starting", { mode: "textOnly" });

      this.conversation = await Conversation.startSession({
        agentId: this._agentId,
        textOnly: true,
        clientTools: {
          get_game_state: async () => {
            debugLog("tool_call", { tool: "get_game_state" });
            voiceLog("Tool: get_game_state called", "tool");
            if (!this.gameAPI) return JSON.stringify({ error: "GameAPI not connected" });
            const state = this.gameAPI.getGameState();
            const result = JSON.stringify(state);
            debugLog("tool_result", { tool: "get_game_state", keys: Object.keys(state) });
            voiceLog("Tool: game state sent (" + Object.keys(state).join(", ") + ")", "tool");
            return result;
          },
          execute_actions: async ({ actions }) => {
            if (!this.gameAPI) return JSON.stringify({ error: "GameAPI not connected" });
            const parsed = typeof actions === "string" ? JSON.parse(actions) : actions;
            debugLog("tool_call", { tool: "execute_actions", actions: parsed });
            voiceLog("Tool: execute_actions — " + JSON.stringify(parsed).slice(0, 100), "tool");
            const actionResult = this.gameAPI.executeActions(parsed);
            const result = JSON.stringify(actionResult);
            debugLog("tool_result", { tool: "execute_actions", result });
            // Show clean action results
            for (const r of actionResult) {
              if (r.success) {
                voiceLog("Deployed " + r.card + " " + r.lane, "action");
              }
            }
            return result;
          },
        },
        onMessage: (msg) => {
          debugLog("message_received", { source: msg.source, message: msg.message });
          if (msg.source === "ai") {
            voiceLog("Commander: " + msg.message, "agent");
            // Record message for echo detection before speaking
            if (window.__speechInput) window.__speechInput.addAgentMessage(msg.message);
            // Speak the agent's response using ElevenLabs TTS
            speakText(msg.message);
          } else if (msg.source === "user") {
            voiceLog("You: " + msg.message, "player");
          }
          if (this.onMessage) this.onMessage(msg);
        },
        onModeChange: (mode) => {
          debugLog("mode_change", { mode: JSON.stringify(mode) });
          if (this.onModeChange) this.onModeChange(mode);
        },
        onStatusChange: (status) => {
          debugLog("status_change", { status });
          const statusStr = typeof status === 'object' ? (status.status || JSON.stringify(status)) : status;
          voiceLog("Status: " + statusStr, "system");
          this.setStatus(status);
        },
        onError: (err) => {
          debugLog("error", { message: err.message, stack: err.stack, raw: String(err) });
          console.error("[VoiceSession] Error:", err);
          voiceLog("Error: " + (err.message || err), "error");
          if (this.onError) this.onError(err);
        },
        onDisconnect: () => {
          debugLog("disconnect");
          this._handleDisconnect();
        },
      });

      this._reconnecting = false;
      if (!this._isReconnect) this._reconnectAttempts = 0;
      this._isReconnect = false;
      debugLog("connected", { textOnly: true });
      voiceLog("Voice agent connected (text mode)!", "system");
      this.setStatus("connected");

      // Send initial message to engage the agent
      setTimeout(() => {
        if (this.isActive()) {
          const state = this.gameAPI ? this.gameAPI.getGameState() : {};
          this.conversation.sendUserMessage(
            "Battle started! I have " + (state.mana || 0) + " mana. What should I play?"
          );
          debugLog("initial_engage", { mana: state.mana });
        }
      }, 500);
    } catch (err) {
      debugLog("error", { message: err.message, stack: err.stack, raw: String(err) });
      console.error("[VoiceSession] Failed to start:", err);
      voiceLog("Connection failed: " + err.message, "error");
      this.setStatus("error");
      if (this.onError) this.onError(err);
    }
  }

  async stop() {
    this._reconnecting = false;
    // Stop any playing TTS audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (this.conversation) {
      try {
        await this.conversation.endSession();
      } catch (err) {
        console.error("[VoiceSession] Error ending session:", err);
      }
      this.conversation = null;
    }
    debugLog("session_stopped");
    voiceLog("Voice session stopped", "system");
    this.setStatus("disconnected");
  }

  async _handleDisconnect() {
    if (this._reconnecting) return;
    this._reconnectAttempts++;

    if (this._reconnectAttempts > 1) {
      debugLog("reconnect_stopped");
      this._reconnecting = false;
      this.conversation = null;
      this.setStatus("disconnected");
      // Don't treat as error — Mistral strategy path is the primary AI brain
      return;
    }

    this._reconnecting = true;
    this.conversation = null;

    debugLog("reconnect_attempt", { attempt: this._reconnectAttempts });
    this.setStatus("reconnecting");

    await new Promise((r) => setTimeout(r, 2000));

    if (!this._reconnecting) return;

    try {
      this._isReconnect = true;
      await this.start();
    } catch (err) {
      debugLog("reconnect_failed");
      voiceLog("Reconnection failed", "error");
      console.error("[VoiceSession] Reconnect failed:", err);
      this._reconnecting = false;
      this.setStatus("error");
      if (this.onError) this.onError(new Error("reconnect_failed"));
    }
  }

  setStatus(status) {
    const resolved = typeof status === 'object' ? (status.status || String(status)) : status;
    this.status = resolved;
    if (this.onStatusChange) this.onStatusChange(resolved);
  }

  isActive() {
    return this.conversation !== null && this.status === "connected";
  }

  sendText(text) {
    if (!this.conversation || !this.isActive()) return;
    try {
      debugLog("send_user_message", { text });
      voiceLog("\u2192 Agent: " + text, "system");
      this.conversation.sendUserMessage(text);
    } catch (e) {
      console.warn('[VoiceSession] sendText failed:', e);
    }
  }

  async sendContextualUpdate(eventType, params = {}) {
    if (!this.conversation || !this.isActive()) return;

    let text;
    const templates = CONTEXTUAL_MESSAGES[eventType];
    if (templates) {
      text = pickRandom(templates);
      for (const [key, value] of Object.entries(params)) {
        text = text.replace(`{${key}}`, value);
      }
    } else {
      text = typeof eventType === "string" ? eventType : String(eventType);
    }

    try {
      debugLog("contextual_update", { text });
      voiceLog("Context update: " + text, "system");
      await this.conversation.sendContextualUpdate({ text });
    } catch (e) {
      console.warn('[VoiceSession] contextual update failed:', e);
    }
  }

  static getErrorMessage(errorType) {
    return ERROR_MESSAGES[errorType] || ERROR_MESSAGES.unknown;
  }
}
