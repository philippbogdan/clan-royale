import VoiceSession from "../VoiceSession.js";

const STATUS_LABELS = {
  disconnected: "Ready",
  connecting: "Connecting...",
  connected: "Listening",
  listening: "Listening",
  speaking: "Speaking",
  thinking: "Thinking...",
  deploying: "Deploying!",
  reconnecting: "Reconnecting...",
  error: "Error",
};

export default class VoiceUI {
  constructor(containerId = "voice-ui") {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[VoiceUI] #${containerId} not found in DOM`);
      return;
    }

    this.voiceSession = null;
    this.agentId = null;
    this.isSessionActive = false;

    this.buildDOM();
    this.applyStyles();
    this.bindEvents();
    this.setStatus("disconnected");
  }

  buildDOM() {
    this.container.innerHTML = `
      <div class="vc">
        <div class="vc-messages"></div>
        <div class="vc-bar">
          <button class="vc-mic" title="Toggle voice">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <input type="text" class="vc-input" placeholder="Command your troops..." />
          <button class="vc-send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
          <div class="vc-status">
            <span class="vc-dot"></span>
          </div>
        </div>
      </div>
    `;

    this.messages = this.container.querySelector(".vc-messages");
    this.micBtn = this.container.querySelector(".vc-mic");
    this.textInput = this.container.querySelector(".vc-input");
    this.sendBtn = this.container.querySelector(".vc-send");
    this.statusDot = this.container.querySelector(".vc-dot");
  }

  applyStyles() {
    if (document.getElementById("vc-styles")) return;

    const style = document.createElement("style");
    style.id = "vc-styles";
    style.textContent = `
      .vc {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: 'Nunito', sans-serif;
      }

      .vc-messages {
        flex: 1;
        overflow-y: auto;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .vc-messages::-webkit-scrollbar { width: 2px; }
      .vc-messages::-webkit-scrollbar-track { background: transparent; }
      .vc-messages::-webkit-scrollbar-thumb { background: #333; }

      .vc-msg {
        font-size: 12px;
        line-height: 1.4;
        padding: 0;
      }

      .vc-msg .vc-tag {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        margin-right: 5px;
      }

      .vc-msg.player { color: #ddd; }
      .vc-msg.player .vc-tag { color: #e85d4a; }

      .vc-msg.agent { color: #ddd; }
      .vc-msg.agent .vc-tag { color: #4a9; }

      .vc-msg.system {
        color: #555;
        font-size: 11px;
        font-style: italic;
      }
      .vc-msg.system .vc-tag { display: none; }

      .vc-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        border-top: 1px solid #222;
        background: #0a0a0a;
      }

      .vc-mic {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid #333;
        background: transparent;
        color: #666;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .vc-mic:hover {
        color: #aaa;
        border-color: #555;
      }

      .vc-mic.active {
        color: #fff;
        background: #c33;
        border-color: #c33;
      }

      .vc-input {
        flex: 1;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 0;
        color: #ccc;
        font-family: 'Nunito', sans-serif;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 8px;
        outline: none;
        min-width: 0;
      }

      .vc-input:focus {
        border-color: #555;
      }

      .vc-input::placeholder {
        color: #444;
      }

      .vc-send {
        width: 30px;
        height: 30px;
        border-radius: 0;
        border: 1px solid #333;
        background: #1a1a1a;
        color: #888;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .vc-send:hover {
        background: #222;
        color: #ccc;
      }

      .vc-send:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .vc-status {
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }

      .vc-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #333;
      }

      .vc-dot.ready { background: #4a4; }
      .vc-dot.listening { background: #4a4; animation: vc-blink 1.2s infinite; }
      .vc-dot.speaking { background: #da3; animation: vc-blink 0.6s infinite; }
      .vc-dot.connecting { background: #da3; animation: vc-blink 0.4s infinite; }
      .vc-dot.reconnecting { background: #da3; animation: vc-blink 0.4s infinite; }
      .vc-dot.thinking { background: #da3; animation: vc-blink 0.8s infinite; }
      .vc-dot.deploying { background: #e85d4a; animation: vc-blink 0.3s infinite; }
      .vc-dot.error { background: #c33; }

      @keyframes vc-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `;

    document.head.appendChild(style);
  }

  bindEvents() {
    this.micBtn.addEventListener("click", () => this.toggleVoice());
    this.sendBtn.addEventListener("click", () => this.sendTextMessage());
    this.textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.sendTextMessage();
    });
  }

  init(gameAPI, agentId) {
    this.agentId = agentId;
    this.voiceSession = new VoiceSession(gameAPI);

    if (!agentId) {
      fetch('http://localhost:3001/api/config')
        .then(r => r.json())
        .then(data => { if (data.agentId) this.setAgentId(data.agentId); })
        .catch(e => console.warn('[VoiceUI] Could not fetch config:', e));
    }

    this.voiceSession.onMessage = (msg) => {
      const role = msg.source === "user" ? "player" : "agent";
      const text = msg.message || msg.text || "";
      if (text) this.addTranscriptMessage(role, text);
    };

    this.voiceSession.onModeChange = (mode) => {
      if (mode.mode === "speaking") this.setStatus("speaking");
      else if (mode.mode === "listening") this.setStatus("listening");
    };

    this.voiceSession.onStatusChange = (status) => {
      if (status === "reconnecting") {
        this.setStatus("reconnecting");
      } else if (status === "error" && !this.voiceSession._reconnecting) {
        this.setStatus("error");
        this.addTranscriptMessage("system", "Connection lost. Tap mic to retry.");
        this.isSessionActive = false;
        this.micBtn.classList.remove("active");
      } else {
        this.setStatus(status);
      }
    };

    this.voiceSession.onError = (err) => {
      const msg = err && err.message;
      if (msg === "reconnect_failed") {
        this.setStatus("error");
        this.addTranscriptMessage("system", "Connection lost. Tap mic to retry.");
        this.isSessionActive = false;
        this.micBtn.classList.remove("active");
      } else {
        this.setStatus("error");
        this.addTranscriptMessage("system", VoiceSession.getErrorMessage("unknown"));
      }
    };

    gameAPI.onGameEvent((event) => {
      const update = gameAPI.getContextualUpdate();
      if (update && this.voiceSession) {
        this.voiceSession.sendContextualUpdate(update);
      }
    });
  }

  setAgentId(agentId) {
    this.agentId = agentId;
  }

  async toggleVoice() {
    if (!this.voiceSession) {
      this.addTranscriptMessage("system", "Voice not initialized.");
      return;
    }

    if (this.isSessionActive) {
      await this.voiceSession.stop();
      this.isSessionActive = false;
      this.micBtn.classList.remove("active");
      this.setStatus("disconnected");
    } else {
      if (!this.agentId) {
        this.addTranscriptMessage("system", "No agent ID configured.");
        return;
      }
      this.micBtn.classList.add("active");
      await this.voiceSession.start(this.agentId);
      this.isSessionActive = true;
    }
  }

  async sendTextMessage() {
    const text = this.textInput.value.trim();
    if (!text) return;

    this.addTranscriptMessage("player", text);
    this.textInput.value = "";
    this.setSendEnabled(false);

    try {
      const gameAPI = window.gameAPI;
      if (!gameAPI) {
        this.addTranscriptMessage("system", "Game not ready yet.");
        this.setSendEnabled(true);
        return;
      }
      const gameState = gameAPI.getGameState();

      this.setStatus("thinking");
      const res = await fetch("http://localhost:3001/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameState, playerCommand: text }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Server error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const { actions, reasoning, urgency } = data;

      if (reasoning) {
        const prefix = urgency ? `[${urgency.toUpperCase()}] ` : "";
        this.addTranscriptMessage("agent", `${prefix}${reasoning}`);
      }

      if (actions && actions.length > 0) {
        this.setStatus("deploying");
        const results = gameAPI.executeActions(actions);

        results.forEach((result, i) => {
          if (result.success) {
            this.addTranscriptMessage("system", `Deployed ${result.card} → ${result.lane}`);
          } else {
            this.addTranscriptMessage("system", `Failed: ${result.error}`);
          }
        });
      }
    } catch (err) {
      this.setStatus("error");
      this.addTranscriptMessage("system", `Error: ${err.message}`);
    } finally {
      this.setStatus("disconnected");
      this.setSendEnabled(true);
    }
  }

  setSendEnabled(enabled) {
    this.sendBtn.disabled = !enabled;
    this.textInput.disabled = !enabled;
  }

  addTranscriptMessage(role, text) {
    const msg = document.createElement("div");
    msg.className = `vc-msg ${role}`;

    if (role !== "system") {
      const tag = document.createElement("span");
      tag.className = "vc-tag";
      tag.textContent = role === "player" ? "you" : "cmd";
      msg.appendChild(tag);
    }

    msg.appendChild(document.createTextNode(text));
    this.messages.appendChild(msg);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  setStatus(status) {
    this.statusDot.className = "vc-dot";
    if (status === "disconnected") this.statusDot.classList.add("ready");
    else if (status === "connected" || status === "listening") this.statusDot.classList.add("listening");
    else if (status === "speaking") this.statusDot.classList.add("speaking");
    else if (status === "connecting") this.statusDot.classList.add("connecting");
    else if (status === "reconnecting") this.statusDot.classList.add("reconnecting");
    else if (status === "thinking") this.statusDot.classList.add("thinking");
    else if (status === "deploying") this.statusDot.classList.add("deploying");
    else if (status === "error") this.statusDot.classList.add("error");
  }
}
