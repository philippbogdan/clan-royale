// SpeechInput - Always-on voice transcription using Deepgram real-time STT
// Streams mic audio over WebSocket to Deepgram Nova-2 for low-latency transcription

function debugLog(event, data) {
  if (typeof window === 'undefined') return;
  if (!window.__voiceDebugLog) window.__voiceDebugLog = [];
  var entry = { t: new Date().toISOString(), event: event, data: data || null };
  window.__voiceDebugLog.push(entry);
  console.log('[SpeechInput]', entry.t, event, data || '');
}

function voiceLog(text, type) {
  if (typeof window !== 'undefined' && window.addVoiceLog) {
    window.addVoiceLog(text, type || 'system');
  }
}

// Split CamelCase into words: "TankTroop" -> "tank troop"
function camelToWords(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/Troop$/i, '')
    .toLowerCase()
    .trim();
}

export default class SpeechInput {
  constructor(gameAPI) {
    this.gameAPI = gameAPI;
    this.isRunning = false;
    this.isMuted = false; // muted while AI is speaking to prevent feedback
    this.onTranscript = null; // callback: (text, isFinal) => void
    this._strategyPending = false;
    this._recentAgentMessages = []; // for dedup: ignore mic picking up TTS
    this._lastUnmuteTime = 0; // timestamp of last unmute for cooldown
    this._ws = null; // Deepgram WebSocket
    this._mediaRecorder = null;
    this._micStream = null; // mic stream (null if using shared window.__micStream)
    this._ownsMicStream = false; // whether we acquired the mic ourselves
    this._earlyFreezeActive = false; // true when game is frozen on interim, waiting for final
    this._earlyFreezeTimeout = null; // safety timeout to unfreeze if no final arrives
  }

  /** Record an agent message so we can filter it from mic input */
  addAgentMessage(text) {
    this._recentAgentMessages.push(text.toLowerCase().trim());
    // Keep only last 5
    if (this._recentAgentMessages.length > 5) this._recentAgentMessages.shift();
  }

  /** Check if transcript is just the mic echoing recent agent speech */
  _isEcho(text) {
    const lower = text.toLowerCase().trim();
    const inputWords = lower.split(/\s+/).filter(w => w.length >= 4);
    if (inputWords.length === 0) return false;

    for (const msg of this._recentAgentMessages) {
      // Substring match (original)
      if (msg.length > 5 && lower.includes(msg.substring(0, Math.floor(msg.length * 0.6)))) {
        return true;
      }
      if (lower.length > 5 && msg.includes(lower.substring(0, Math.floor(lower.length * 0.6)))) {
        return true;
      }
      // Word-level overlap: if >=40% of input words appear in agent message, it's echo
      const msgWords = msg.split(/\s+/).filter(w => w.length >= 4);
      let overlap = 0;
      for (const w of inputWords) {
        if (msgWords.some(mw => mw.includes(w) || w.includes(mw))) overlap++;
      }
      if (inputWords.length >= 3 && overlap / inputWords.length >= 0.70) {
        return true;
      }
    }
    return false;
  }

  async start() {
    console.log('%c[SpeechInput] start() called', 'color: lime; font-weight: bold');
    // 1. Get mic stream — reuse shared stream from landing page if available
    let stream;
    if (window.__micStream) {
      stream = window.__micStream;
      this._ownsMicStream = false;
      console.log('%c[SpeechInput] Reusing shared mic stream', 'color: lime');
      debugLog('mic_reuse_shared');
    } else {
      try {
        console.log('%c[SpeechInput] Requesting mic...', 'color: yellow');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._ownsMicStream = true;
        console.log('%c[SpeechInput] Mic acquired', 'color: lime');
        debugLog('mic_acquired');
      } catch (e) {
        console.error('[SpeechInput] Mic denied:', e.message);
        debugLog('mic_error', { error: e.message });
        voiceLog('Microphone access denied', 'error');
        return;
      }
    }
    this._micStream = stream;
    console.log('[SpeechInput] Stream tracks:', stream.getTracks().map(t => t.kind + ':' + t.readyState));

    // Initialize global state for UI consumption
    window.__userSpeaking = false;
    window.__currentTranscript = '';

    // Set up Web Audio API VAD (voice activity detection)
    try {
      this._vadAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._vadAnalyser = this._vadAudioCtx.createAnalyser();
      this._vadAnalyser.fftSize = 512;
      this._vadAnalyser.smoothingTimeConstant = 0.3;
      const source = this._vadAudioCtx.createMediaStreamSource(stream);
      source.connect(this._vadAnalyser); // do NOT connect to destination (feedback)
      this._vadMicSource = source;
      this._vadNoiseFloor = 0.01;
      this._vadSpeechFrames = 0;
      this._vadSilenceFrames = 0;
      this._vadInterval = setInterval(() => this._pollVAD(), 50);
      debugLog('vad_started');
    } catch (e) {
      debugLog('vad_setup_error', { error: e.message });
    }

    this.isRunning = true;

    // 2. Connect to Deepgram via server proxy
    this._connectDeepgram();

    debugLog('speech_started');
    voiceLog('Voice input active (Deepgram STT)', 'system');
  }

  _pollVAD() {
    if (!this._vadAnalyser) return;
    const data = new Float32Array(this._vadAnalyser.fftSize);
    this._vadAnalyser.getFloatTimeDomainData(data);

    // Calculate RMS volume
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    // Adaptive noise floor (slowly converge toward silence)
    this._vadNoiseFloor = this._vadNoiseFloor * 0.95 + rms * 0.05;

    const threshold = this._vadNoiseFloor * 2.5 + 0.005;
    const isSpeech = rms > threshold;

    if (isSpeech) {
      this._vadSpeechFrames++;
      this._vadSilenceFrames = 0;
    } else {
      this._vadSilenceFrames++;
      this._vadSpeechFrames = 0;
    }

    // Require 3 consecutive speech frames (~150ms) to declare speaking
    if (this._vadSpeechFrames >= 3 && !window.__userSpeaking) {
      window.__userSpeaking = true;
      if (window.addSTTLog) window.addSTTLog('vad', 'speech START');
    }
    // Require 10 consecutive silence frames (~500ms) to stop
    if (this._vadSilenceFrames >= 10 && window.__userSpeaking) {
      window.__userSpeaking = false;
      if (window.addSTTLog) window.addSTTLog('vad', 'speech END');
    }
  }

  _connectDeepgram() {
    if (!this.isRunning) return;

    // Connect through our server proxy (handles Deepgram auth server-side)
    // Deepgram auto-detects WebM/Opus containers, no encoding hint needed
    const wsUrl = 'ws://localhost:3001/deepgram';
    console.log('%c[SpeechInput] Connecting WS: ' + wsUrl, 'color: cyan');
    const ws = new WebSocket(wsUrl);
    this._ws = ws;

    ws.onopen = () => {
      console.log('%c[SpeechInput] WS OPEN — starting MediaRecorder', 'color: lime; font-weight: bold');
      debugLog('deepgram_ws_open');
      this._startMediaRecorder();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'Results') return;

        const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
        if (!alt) return;

        const text = (alt.transcript || '').trim();
        if (!text) return;

        const isFinal = msg.is_final === true || msg.speech_final === true;
        const sttLog = window.addSTTLog;

        // Log EVERY transcript to debug panel
        if (sttLog) {
          if (isFinal) {
            sttLog('final', text, 'conf=' + (alt.confidence || 0).toFixed(2));
          } else {
            sttLog('interim', text);
          }
        }

        // Expose transcript globally for UI display (both interim and final)
        window.__currentTranscript = text;

        // EARLY TACTICAL FREEZE: freeze game on first interim transcript
        if (!isFinal && text.length > 2 && !this._isEcho(text) && !this._earlyFreezeActive && !this._strategyPending) {
          this._earlyFreezeActive = true;
          debugLog('early_freeze', { text });

          // Freeze game immediately
          if (this.gameAPI && this.gameAPI.scene && this.gameAPI.scene.freezeGame) {
            this.gameAPI.scene.freezeGame();
          }

          // Interrupt TTS if AI is speaking and unmute (bypass cooldown since we're in tactical pause)
          if (this.isMuted) {
            if (window.__interruptTTS) window.__interruptTTS();
            this.isMuted = false;
            this._lastUnmuteTime = 0;
          }

          // Safety timeout: if no meaningful final within 3s, unfreeze
          this._earlyFreezeTimeout = setTimeout(() => {
            if (this._earlyFreezeActive) {
              this._earlyFreezeActive = false;
              debugLog('early_freeze_timeout');
              if (this.gameAPI && this.gameAPI.scene && this.gameAPI.scene.unfreezeGame) {
                this.gameAPI.scene.unfreezeGame();
              }
            }
          }, 3000);
        }
        // Also interrupt TTS on interim if muted but already in early freeze
        else if (!isFinal && this.isMuted && text.length > 2 && !this._isEcho(text)) {
          debugLog('speech_interrupt_tts', { text });
          if (typeof window !== 'undefined' && window.__interruptTTS) {
            window.__interruptTTS();
          }
        }

        if (isFinal && text.length > 0) {
          // EARLY FREEZE PATH: game is already frozen, just need to decide if speech is meaningful
          if (this._earlyFreezeActive) {
            clearTimeout(this._earlyFreezeTimeout);
            this._earlyFreezeActive = false;

            // Not meaningful (too short or echo) → unfreeze and return
            if (text.length <= 2 || this._isEcho(text)) {
              debugLog('early_freeze_noise', { text });
              if (sttLog) sttLog('skip', text, 'noise → unfreeze');
              if (this.gameAPI && this.gameAPI.scene && this.gameAPI.scene.unfreezeGame) {
                this.gameAPI.scene.unfreezeGame();
              }
              return;
            }

            // Meaningful → proceed to Mistral (game stays frozen, cinematicDeploy will manage)
            if (sttLog) sttLog('sent', text, '-> Mistral');
            debugLog('speech_transcript', { text, confidence: alt.confidence });
            voiceLog('You: ' + text, 'player');
            this._askMistralStrategy(text);
            if (this.onTranscript) this.onTranscript(text, isFinal);
            setTimeout(() => { window.__currentTranscript = ''; }, 2000);
            return;
          }

          // NORMAL PATH (no early freeze active)
          // Skip if muted (AI is speaking - prevents feedback loop)
          if (this.isMuted) {
            if (sttLog) sttLog('skip', text, 'muted');
            debugLog('speech_ignored_muted', { text });
            return;
          }

          // Cooldown: ignore transcripts arriving within 800ms of unmute
          if (this._lastUnmuteTime && Date.now() - this._lastUnmuteTime < 800) {
            if (sttLog) sttLog('skip', text, 'cooldown ' + (Date.now() - this._lastUnmuteTime) + 'ms');
            debugLog('speech_ignored_cooldown', { text, elapsed: Date.now() - this._lastUnmuteTime });
            return;
          }

          // Skip if this is just the mic picking up agent's TTS output
          if (this._isEcho(text)) {
            if (sttLog) sttLog('skip', text, 'echo');
            debugLog('speech_ignored_echo', { text });
            return;
          }

          if (sttLog) sttLog('sent', text, '-> Mistral');
          debugLog('speech_transcript', { text, confidence: alt.confidence });
          voiceLog('You: ' + text, 'player');

          // All commands go through Mistral for cinematic deploy
          this._askMistralStrategy(text);

          if (this.onTranscript) this.onTranscript(text, isFinal);

          // Clear transcript after a delay so UI can show it briefly
          setTimeout(() => { window.__currentTranscript = ''; }, 2000);
        }
      } catch (e) {
        debugLog('deepgram_parse_error', { error: e.message });
      }
    };

    ws.onclose = (event) => {
      console.warn('[SpeechInput] WS CLOSED code=' + event.code + ' reason=' + event.reason);
      debugLog('deepgram_ws_close', { code: event.code, reason: event.reason });
      this._stopMediaRecorder();
      // Reconnect if still running
      if (this.isRunning) {
        debugLog('deepgram_reconnecting');
        setTimeout(() => this._connectDeepgram(), 1000);
      }
    };

    ws.onerror = (event) => {
      console.error('[SpeechInput] WS ERROR:', event);
      debugLog('deepgram_ws_error', { error: String(event) });
    };
  }

  _startMediaRecorder() {
    if (!this._micStream || this._mediaRecorder) return;

    // Pick a supported mime type (Safari only supports audio/mp4)
    let mimeType = 'audio/webm;codecs=opus';
    if (typeof MediaRecorder !== 'undefined') {
      const supported = [];
      for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg', '']) {
        if (t === '' || MediaRecorder.isTypeSupported(t)) supported.push(t);
      }
      console.log('[SpeechInput] Supported mime types:', supported);
      mimeType = supported[0] || '';
    }
    console.log('%c[SpeechInput] Using mimeType: "' + mimeType + '"', 'color: cyan; font-weight: bold');

    try {
      const recorder = mimeType
        ? new MediaRecorder(this._micStream, { mimeType })
        : new MediaRecorder(this._micStream);
      this._mediaRecorder = recorder;

      let chunkCount = 0;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0 && this._ws && this._ws.readyState === WebSocket.OPEN) {
          chunkCount++;
          if (chunkCount <= 5 || chunkCount % 50 === 0) {
            console.log('[SpeechInput] Audio chunk #' + chunkCount + ' size=' + event.data.size + ' ws=' + this._ws.readyState);
          }
          this._ws.send(event.data);
        }
      };

      recorder.onerror = (e) => {
        console.error('[SpeechInput] MediaRecorder error:', e);
      };

      recorder.start(100); // send chunk every 100ms
      console.log('%c[SpeechInput] MediaRecorder started, state=' + recorder.state, 'color: lime; font-weight: bold');
      debugLog('media_recorder_started', { mimeType });
    } catch (e) {
      console.error('[SpeechInput] MediaRecorder creation FAILED:', e.message);
      debugLog('media_recorder_error', { error: e.message });
    }
  }

  _stopMediaRecorder() {
    if (this._mediaRecorder) {
      try {
        if (this._mediaRecorder.state !== 'inactive') {
          this._mediaRecorder.stop();
        }
      } catch (e) { /* ignore */ }
      this._mediaRecorder = null;
    }
  }

  stop() {
    this.isRunning = false;

    // Clean up early freeze
    if (this._earlyFreezeTimeout) {
      clearTimeout(this._earlyFreezeTimeout);
      this._earlyFreezeTimeout = null;
    }
    this._earlyFreezeActive = false;

    // Clean up VAD
    if (this._vadInterval) {
      clearInterval(this._vadInterval);
      this._vadInterval = null;
    }
    if (this._vadAudioCtx) {
      try { this._vadAudioCtx.close(); } catch (e) { /* ignore */ }
      this._vadAudioCtx = null;
    }
    this._vadAnalyser = null;
    this._vadMicSource = null;
    window.__userSpeaking = false;
    window.__currentTranscript = '';

    // Close WebSocket
    if (this._ws) {
      try { this._ws.close(); } catch (e) { /* ignore */ }
      this._ws = null;
    }

    // Stop MediaRecorder
    this._stopMediaRecorder();

    // Release mic tracks only if we acquired them (not shared)
    if (this._ownsMicStream && this._micStream) {
      this._micStream.getTracks().forEach(track => track.stop());
    }
    this._micStream = null;
    this._ownsMicStream = false;

    debugLog('speech_stopped');
  }

  /** Unfreeze game if it's stuck frozen from early tactical pause (no cinematic deploy ran) */
  _unfreezeIfNeeded() {
    const scene = this.gameAPI && this.gameAPI.scene;
    if (scene && scene._tacticalFrozen && !this.gameAPI._cinematicActive) {
      debugLog('unfreeze_after_strategy');
      scene.unfreezeGame();
    }
  }

  /** Mute to prevent feedback when AI speaks */
  mute() {
    this.isMuted = true;
    debugLog('speech_muted');
  }

  unmute() {
    this.isMuted = false;
    this._lastUnmuteTime = Date.now();
    debugLog('speech_unmuted');
  }

  /**
   * Ask the Mistral strategy API for advice and execute the recommended actions.
   */
  async _askMistralStrategy(playerCommand) {
    // Queue command if one is already being processed
    if (this._strategyPending) {
      if (!this._pendingCommands) this._pendingCommands = [];
      this._pendingCommands.push(playerCommand);
      if (window.addSTTLog) window.addSTTLog('queue', playerCommand, 'queued #' + this._pendingCommands.length);
      debugLog('strategy_queued', { command: playerCommand, queueLength: this._pendingCommands.length });
      voiceLog('Queued: ' + playerCommand, 'system');
      return;
    }
    this._strategyPending = true;
    if (window.addSTTLog) window.addSTTLog('strategy', playerCommand, 'requesting...');

    try {
      const gameState = this.gameAPI.getGameState();
      debugLog('strategy_request', { command: playerCommand, mana: gameState.mana });
      voiceLog('Thinking...', 'system');

      const response = await fetch('http://localhost:3001/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameState, playerCommand, connectorModel: window.connectorModel || null }),
      });

      if (!response.ok) throw new Error('Strategy API returned ' + response.status);

      const data = await response.json();
      debugLog('strategy_response', data);
      if (window.addSTTLog) {
        const actions = (data.actions || []).map(a => a.card || a.type).join(', ');
        window.addSTTLog('strategy', actions || 'no actions', data.reasoning || '');
      }

      // Execute the recommended actions
      if (data.actions && data.actions.length > 0) {
        const msg = data.reasoning || 'Deploying troops!';
        this.addAgentMessage(msg); // prevent echo

        // Use cinematic deploy if available, otherwise fall back to direct execution
        if (this.gameAPI.cinematicDeploy) {
          const results = await this.gameAPI.cinematicDeploy(data.actions, msg);
          const deployed = results.filter(r => r.success).map(r => r.card);
          const failed = results.filter(r => !r.success).map(r => r.error);
          if (deployed.length > 0) voiceLog('Deployed: ' + deployed.join(', '), 'action');
          if (failed.length > 0) voiceLog('Failed: ' + failed.join('; '), 'error');
          debugLog('cinematic_deployed', { deployed, failed, reasoning: msg });
        } else {
          // Fallback: direct execution
          const results = this.gameAPI.executeActions(data.actions);
          const deployed = results.filter(r => r.success).map(r => r.card);
          const failed = results.filter(r => !r.success).map(r => r.error);
          if (deployed.length > 0) voiceLog('Deployed: ' + deployed.join(', '), 'action');
          if (failed.length > 0) voiceLog('Failed: ' + failed.join('; '), 'error');
          if (window.__speakText) window.__speakText(msg);
          debugLog('strategy_executed', { deployed, failed, reasoning: msg });
          this._unfreezeIfNeeded();
        }
      } else {
        // No actions — just speak the reasoning
        const msg = data.reasoning || 'Holding position, saving mana.';
        voiceLog('Strategy: ' + msg, 'agent');
        this.addAgentMessage(msg);
        if (window.__speakText) window.__speakText(msg);
        // Unfreeze if game was frozen by early tactical pause (no cinematic deploy to clean up)
        this._unfreezeIfNeeded();
      }
    } catch (e) {
      debugLog('strategy_error', { error: e.message });
      voiceLog('Strategy unavailable', 'error');
      // Unfreeze if game was frozen by early tactical pause
      this._unfreezeIfNeeded();
    } finally {
      this._strategyPending = false;

      // Process next queued command if any
      if (this._pendingCommands && this._pendingCommands.length > 0) {
        const nextCommand = this._pendingCommands.shift();
        debugLog('strategy_dequeue', { command: nextCommand, remaining: this._pendingCommands.length });
        this._askMistralStrategy(nextCommand);
      }
    }
  }

  /**
   * Parse a voice transcript into a game command.
   * Matches patterns like:
   *   "play tank left"
   *   "deploy alien right"
   *   "put quacker on left"
   *   "send cow right"
   */
  parseCommand(text) {
    const lower = text.toLowerCase();

    // Get the current hand to match card names
    const hand = this.gameAPI.getHand();
    if (!hand || hand.length === 0) return null;

    // Determine lane
    let lane = null;
    if (lower.includes('left')) lane = 'left';
    else if (lower.includes('right')) lane = 'right';
    if (!lane) lane = 'left';

    // Try to match a card name from the hand
    let matchedCard = null;

    for (const card of hand) {
      // CamelCase names like "TankTroop" -> "tank"
      const words = camelToWords(card.name);
      // Full match: "tank", "battle otter", "mama cow"
      if (lower.includes(words)) {
        matchedCard = card.name;
        break;
      }
    }

    // Partial match: each word in the card name
    if (!matchedCard) {
      for (const card of hand) {
        const words = camelToWords(card.name).split(' ');
        for (const word of words) {
          if (word.length >= 3 && lower.includes(word)) {
            matchedCard = card.name;
            break;
          }
        }
        if (matchedCard) break;
      }
    }

    if (matchedCard) {
      return { type: 'play_card', card: matchedCard, lane };
    }

    return null;
  }
}
