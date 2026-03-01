import Phaser from "phaser";
import { Scene } from "phaser";

class UIScene extends Scene {
  constructor() {
    super("UIScene");
  }

  create() {
    let centerX = this.cameras.main.centerX;
    let centerY = this.cameras.main.centerY;
    let sceneWidth = this.cameras.main.width;
    let sceneHeight = this.cameras.main.height;

    // ── SPECTATOR MODE CHECK ──
    this.isSpectatorMode = window.gameMode === 'spectator';

    // (Menu removed for cleaner UI)

    // ── LANE DIVIDER ──
    const dividerX = 80;
    const dotSize = 1;
    const dotGap = 4;
    for (let y = 30; y < 200; y += dotGap) {
      this.add
        .rectangle(dividerX, y, dotSize, dotSize, 0xC4A265)
        .setAlpha(0.1)
        .setOrigin(0.5, 0.5);
    }

    // ── GRID OVERLAY (visible during tactical pause only) ──
    this.gridGraphics = this.add.graphics().setDepth(151).setAlpha(0);

    // (Status readout removed for cleaner UI)

    // (Mana bar handled by ManaBank's built-in DisplayBar)

    // ── DEPLOY QUEUE DISPLAY ──
    this.queueContainer = this.add.container(0, 0).setDepth(10001);
    this._queueSprites = [];
    this._prevQueueLength = -1;
    this._queuePulseTween = null;
    this.queueLabel = this.add
      .bitmapText(4, sceneHeight - 17, "teeny-tiny-pixls", "QUEUE", 5)
      .setTint(0xC4A265).setAlpha(0).setDepth(10001);

    // ── HEALTH BARS (drawn each frame via Graphics) ──
    this.healthBars = this.add.graphics();
    this.healthBars.setDepth(50);

    // ── MATCH TIMER ──
    this._matchTime = 180; // 3 minutes in seconds
    this._matchTimerAccum = 0;
    this._doubleElixir = false;
    this._doubleElixirShown = false;
    this._matchEnded = false;

    // Timer via HTML overlay (smooth anti-aliased text)
    // Offset position since overlay centers text via translate(-50%,-50%),
    // but original used origin(0,0) at (5,5)
    const timerOverlay = window.__textOverlay;
    this._timerOverlayId = timerOverlay ? timerOverlay.add(14, 8, "3:00", {
      fontSize: 6, color: '#DAA520', stroke: '#000000', fontWeight: 'bold', alpha: 0.9
    }) : null;

    // Double elixir flash text (hidden)
    this.doubleElixirText = this.add
      .bitmapText(centerX, 28, "teeny-tiny-pixls", "x2 ELIXIR!", 5)
      .setTint(0xDAA520)
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(95);

    this._timerPulseTween = null;

    // ── DEPLOYMENT FLASH ──
    this.deployFlash = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0xDAA520)
      .setAlpha(0)
      .setDepth(100);

    // ── AI THINKING OVERLAY ──
    this.aiThinkingBg = this.add
      .rectangle(centerX, 20, sceneWidth - 10, 11, 0x2B1A0E)
      .setAlpha(0)
      .setDepth(90);

    this.aiThinkingText = this.add
      .bitmapText(centerX, 20, "teeny-tiny-pixls", "AI ANALYZING...", 5)
      .setTint(0xC4A265)
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(91);

    this.aiThinkingTween = null;

    // ── VICTORY / DEFEAT OVERLAY (hidden by default) ──
    this.gameOverContainer = this.add.container(0, 0).setDepth(200).setAlpha(0);

    // Full-screen dark overlay
    this.gameOverBg = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0x2B1A0E)
      .setAlpha(0.85);
    this.gameOverContainer.add(this.gameOverBg);

    // Scanline effect on game over screen
    for (let y = 0; y < sceneHeight; y += 2) {
      const scanline = this.add
        .rectangle(centerX, y, sceneWidth, 1, 0x000000)
        .setAlpha(0.15);
      this.gameOverContainer.add(scanline);
    }

    // Result text (VICTORY or DEFEAT)
    this.gameOverTitle = this.add
      .bitmapText(centerX, centerY - 30, "teeny-tiny-pixls", "", 10)
      .setOrigin(0.5, 0.5);
    this.gameOverContainer.add(this.gameOverTitle);

    // Sub-text
    this.gameOverSub = this.add
      .bitmapText(centerX, centerY - 10, "teeny-tiny-pixls", "", 5)
      .setOrigin(0.5, 0.5)
      .setTint(0xF5E6C8);
    this.gameOverContainer.add(this.gameOverSub);

    // PLAY AGAIN button
    const btnBg = this.add
      .rectangle(centerX, centerY + 15, 60, 12, 0x3B2312)
      .setStrokeStyle(1, 0xDAA520, 0.8)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        btnBg.setFillStyle(0x5C3A1E);
        btnText.setTint(0xFFF8E7);
      })
      .on("pointerout", () => {
        btnBg.setFillStyle(0x3B2312);
        btnText.setTint(0xDAA520);
      })
      .on("pointerdown", () => {
        this._restartGame();
      });
    this.gameOverContainer.add(btnBg);

    const btnText = this.add
      .bitmapText(centerX, centerY + 15, "teeny-tiny-pixls", "PLAY AGAIN", 5)
      .setTint(0xDAA520)
      .setOrigin(0.5, 0.5);
    this.gameOverContainer.add(btnText);

    // Decorative bracket lines around title
    this.gameOverBracketL = this.add
      .rectangle(centerX - 50, centerY - 30, 8, 1, 0xDAA520)
      .setAlpha(0.5);
    this.gameOverContainer.add(this.gameOverBracketL);

    this.gameOverBracketR = this.add
      .rectangle(centerX + 50, centerY - 30, 8, 1, 0xDAA520)
      .setAlpha(0.5);
    this.gameOverContainer.add(this.gameOverBracketR);

    this._gameOverShown = false;

    // ── COMMANDER MASCOT (top-right, rendered as DOM element above HTML text overlay) ──
    const mascotX = sceneWidth - 30;
    const mascotY = 4;

    // Golden glow shadow behind the king (canvas glow, under dim overlay — decorative only)
    this.mascotGlow = this.add.graphics();
    this.mascotGlow.setDepth(154);
    this.mascotGlow.setAlpha(0);
    const glowCx = mascotX;
    const glowCy = mascotY + 20;
    this.mascotGlow.fillStyle(0xDAA520, 0.15);
    this.mascotGlow.fillCircle(glowCx, glowCy, 28);
    this.mascotGlow.fillStyle(0xDAA520, 0.2);
    this.mascotGlow.fillCircle(glowCx, glowCy, 22);
    this.mascotGlow.fillStyle(0xDAA520, 0.25);
    this.mascotGlow.fillCircle(glowCx, glowCy, 16);
    this.mascotGlow.fillStyle(0xFFD700, 0.15);
    this.mascotGlow.fillCircle(glowCx, glowCy, 10);

    // Mascot is now a DOM image (above HTML text overlay) via TextOverlay
    this._mascotVisible = false;
    this._mascotMouthOpen = false;
    this._mascotMouthTimer = 0;
    this._mascotMouthInterval = 180;

    // ── TRANSCRIPT TEXT (below mascot, only visible during tactical pause) ──
    this.transcriptText = this.add
      .bitmapText(mascotX, mascotY + 38, "teeny-tiny-pixls", "", 5)
      .setTint(0xF5E6C8)
      .setOrigin(1, 0)
      .setDepth(155)
      .setAlpha(0);

    this._transcriptFadeTimer = 0;
    this._lastTranscriptText = "";

    // ── MIC ACTIVITY INDICATOR (green dot, top-right near mascot area) ──
    this.micIndicator = this.add.graphics();
    this.micIndicator.fillStyle(0x4ADE80, 1);
    this.micIndicator.fillCircle(0, 0, 2);
    this.micIndicator.setPosition(sceneWidth - 4, mascotY + 2);
    this.micIndicator.setDepth(155);
    this.micIndicator.setAlpha(0);
    this._micPulseTween = null;

    // ── SPECTATOR MODE: hide voice UI, show chat panels ──
    if (this.isSpectatorMode) {
      // Hide voice-related elements
      this.mascotGlow.setAlpha(0).setVisible(false);
      this.transcriptText.setVisible(false);
      this.micIndicator.setVisible(false);
      this.queueLabel.setVisible(false);

      // Create DOM-based chat panels
      this._createSpectatorPanels();
    }

    // ── EVENT LISTENERS ──
    this.game.registry.events.on("changedata-voiceStatus", (parent, value) => {
      this.setVoiceStatus(value);
    });

    this.game.registry.events.on("changedata-deployEvent", (parent, value) => {
      if (value) {
        this.flashDeploy();
      }
    });

    if (!this.game.registry.has("voiceStatus")) {
      this.game.registry.set("voiceStatus", "ready");
    }

    // ── TACTICAL PAUSE OVERLAY ──
    // Dim overlay (darkens the screen during tactical pause)
    this.dimOverlay = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0x000000)
      .setAlpha(0)
      .setDepth(150);

    // Container for ghost preview sprites
    this.ghostContainer = this.add.container(0, 0).setDepth(160);

    // (Tactical pause text removed — dim overlay is sufficient indicator)

    // Deploy flash for tactical deploy (white/gold full screen)
    this.tacticalFlash = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0xFFF8E7)
      .setAlpha(0)
      .setDepth(170);

    // ── SPECTATOR AI-DECISION LISTENER ──
    if (this.isSpectatorMode) {
      const playSceneForSpectator = this.scene.get("PlayScene");
      if (playSceneForSpectator) {
        playSceneForSpectator.events.on("ai-decision", ({ side, decision }) => {
          const reasoning = (decision.orchestrator && decision.orchestrator.reasoning) || '';
          const actions = ((decision.connector && decision.connector.actions) || [])
            .map(a => `${a.card} → (${a.col},${a.row})`)
            .join(', ');
          const text = reasoning + (actions ? '\n→ ' + actions : '');

          if (side === 'player') this._addSpectatorMessage('left', text);
          else this._addSpectatorMessage('right', text);
        });
      }
    }

    // ── TACTICAL PAUSE EVENT LISTENERS ──
    const playSceneRef = this.scene.get("PlayScene");

    playSceneRef.events.on("tactical-freeze", () => {
      // Fade in dim overlay
      this.tweens.add({
        targets: this.dimOverlay,
        alpha: 0.55,
        duration: 300,
        ease: "Power2"
      });
      // Dim HTML text overlay to match
      if (window.__textOverlay) window.__textOverlay.setDimmed(true);
      // Show grid overlay
      this._drawGrid();
      this.tweens.add({
        targets: this.gridGraphics,
        alpha: 1,
        duration: 200,
        ease: "Power2"
      });
    });

    playSceneRef.events.on("tactical-preview", (previewData) => {
      // previewData: array of {card, lane, x, y}
      this.ghostContainer.removeAll(true);
      for (const item of previewData) {
        const spriteKey = item.card.replace("Troop", "").toLowerCase();

        // Use sprite if texture exists, otherwise a colored rectangle fallback
        let ghost;
        if (this.textures.exists(spriteKey)) {
          ghost = this.add.sprite(item.x, item.y, spriteKey)
            .setAlpha(0.8)
            .setTint(0xFFFFFF)
            .setDepth(160);
        } else {
          ghost = this.add.rectangle(item.x, item.y, 8, 8, 0xFFFFFF)
            .setAlpha(0.8)
            .setDepth(160);
        }

        // Pulsing glow effect
        this.tweens.add({
          targets: ghost,
          alpha: { from: 0.8, to: 0.4 },
          scaleX: { from: 1, to: 1.15 },
          scaleY: { from: 1, to: 1.15 },
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut"
        });

        // Lane label under ghost
        const label = this.add
          .bitmapText(item.x, item.y + 10, "teeny-tiny-pixls", item.card.replace("Troop", "").toUpperCase(), 5)
          .setTint(0xDAA520)
          .setOrigin(0.5, 0)
          .setDepth(161);

        this.ghostContainer.add(ghost);
        this.ghostContainer.add(label);
      }
    });

    playSceneRef.events.on("tactical-deploy", () => {
      // Deploy flash
      this.tacticalFlash.setAlpha(0.5);
      this.tweens.add({
        targets: this.tacticalFlash,
        alpha: 0,
        duration: 300,
        ease: "Power2"
      });

      // Remove ghosts
      this.ghostContainer.removeAll(true);

      // Fade out dim overlay
      this.tweens.add({
        targets: this.dimOverlay,
        alpha: 0,
        duration: 400,
        ease: "Power2"
      });
      // Undim HTML text overlay
      if (window.__textOverlay) window.__textOverlay.setDimmed(false);

      // Fade out grid overlay
      this.tweens.add({
        targets: this.gridGraphics,
        alpha: 0,
        duration: 300,
        ease: "Power2",
        onComplete: () => this.gridGraphics.clear()
      });

      // Subtle screen shake on deploy
      this.cameras.main.shake(200, 0.008);
    });

    playSceneRef.events.on("tactical-unfreeze", () => {
      // Undim HTML text overlay on any unfreeze (covers cancel case)
      if (window.__textOverlay) window.__textOverlay.setDimmed(false);
      // Fade out grid overlay
      this.tweens.add({
        targets: this.gridGraphics,
        alpha: 0,
        duration: 300,
        ease: "Power2",
        onComplete: () => this.gridGraphics.clear()
      });
    });

    // ── CARD DRAG ANIMATION (smooth drag from deck slot to grid cell) ──
    playSceneRef.events.on("tactical-card-flight", (flightData) => {
      const slotPositions = [
        { x: 39, y: 242 },
        { x: 69, y: 242 },
        { x: 99, y: 242 },
        { x: 129, y: 242 }
      ];

      const allHighlights = [];
      const totalCards = flightData.length;

      for (let i = 0; i < totalCards; i++) {
        const fd = flightData[i];
        const slotPos = slotPositions[fd.slotIndex] || slotPositions[0];

        this.time.delayedCall(i * 200, () => {
          // Create flight sprite at deck slot, full opacity, steady size
          let flightSprite;
          if (fd.textureKey && this.textures.exists(fd.textureKey)) {
            flightSprite = this.add.sprite(slotPos.x, slotPos.y, fd.textureKey)
              .setDepth(165).setAlpha(1);
          } else {
            flightSprite = this.add.rectangle(slotPos.x, slotPos.y, 8, 8, 0xDAA520)
              .setDepth(165).setAlpha(1);
          }

          // Build CubicBezier path (4 control points for natural drag feel)
          const lerp = (a, b, t) => a + (b - a) * t;
          const P0 = new Phaser.Math.Vector2(slotPos.x, slotPos.y);
          const P1 = new Phaser.Math.Vector2(lerp(slotPos.x, fd.targetX, 0.3), 215);
          const P2 = new Phaser.Math.Vector2(lerp(slotPos.x, fd.targetX, 0.7), lerp(215, fd.targetY, 0.6));
          const P3 = new Phaser.Math.Vector2(fd.targetX, fd.targetY);
          const curve = new Phaser.Curves.CubicBezier(P0, P1, P2, P3);

          let lastCol = -1;
          let lastRow = -1;
          const cardHighlights = [];

          // Animate along the curve
          const tweenObj = { t: 0 };
          this.tweens.add({
            targets: tweenObj,
            t: 1,
            duration: 800,
            ease: "Sine.easeInOut",
            onUpdate: () => {
              const point = curve.getPointAt(tweenObj.t);
              flightSprite.setPosition(point.x, point.y);

              // Check which grid cell the sprite is over
              const col = Math.floor(point.x / 16);
              const row = Math.floor((point.y - 115) / 15);
              const inGrid = col >= 0 && col < 10 && row >= 0 && row < 6;

              if (inGrid && (col !== lastCol || row !== lastRow)) {
                // Fade previous highlights to trail alpha
                for (const h of cardHighlights) {
                  this.tweens.add({
                    targets: h,
                    alpha: 0.1,
                    duration: 150,
                    ease: "Power2"
                  });
                }

                // Draw new highlight rectangle
                const highlight = this.add
                  .rectangle(col * 16 + 8, 115 + row * 15 + 7.5, 16, 15, 0xDAA520)
                  .setAlpha(0.3)
                  .setDepth(152);
                cardHighlights.push(highlight);
                allHighlights.push(highlight);

                this._playTick();
                lastCol = col;
                lastRow = row;
              }
            },
            onComplete: () => {
              // Hold at destination with pulsing highlight
              const finalHighlight = cardHighlights[cardHighlights.length - 1];
              if (finalHighlight) {
                this.tweens.add({
                  targets: finalHighlight,
                  alpha: { from: 0.3, to: 0.5 },
                  duration: 150,
                  yoyo: true,
                  repeat: 0,
                  ease: "Sine.easeInOut"
                });
              }

              // Play spawn SFX at hold moment
              if (window.__playSFX) window.__playSFX('spawn');

              // After 300ms hold, fade out sprite
              this.time.delayedCall(300, () => {
                this.tweens.add({
                  targets: flightSprite,
                  alpha: 0,
                  duration: 150,
                  ease: "Power2",
                  onComplete: () => {
                    flightSprite.destroy();
                  }
                });
              });

              // If this is the last card, clean up all highlights after landing
              if (i === totalCards - 1) {
                this.time.delayedCall(600, () => {
                  for (const h of allHighlights) {
                    if (h && h.active) {
                      this.tweens.add({
                        targets: h,
                        alpha: 0,
                        duration: 300,
                        ease: "Power2",
                        onComplete: () => h.destroy()
                      });
                    }
                  }
                });
              }
            }
          });
        });
      }
    });
  }

  /**
   * Set the voice/AI status indicator text and color.
   */
  setVoiceStatus(status) {
    // AI Thinking overlay
    if (status === "thinking") {
      this._showAIThinking();
    } else {
      this._hideAIThinking();
    }
  }

  /**
   * Show pulsing AI ANALYZING overlay.
   */
  _showAIThinking() {
    if (this.aiThinkingTween) return;

    this.aiThinkingBg.setAlpha(0.4);
    this.aiThinkingText.setAlpha(1);

    this.aiThinkingTween = this.tweens.add({
      targets: this.aiThinkingText,
      alpha: { from: 1, to: 0.3 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
  }

  /**
   * Hide AI thinking overlay.
   */
  _hideAIThinking() {
    if (this.aiThinkingTween) {
      this.aiThinkingTween.stop();
      this.aiThinkingTween = null;
    }
    this.aiThinkingBg.setAlpha(0);
    this.aiThinkingText.setAlpha(0);
  }

  /**
   * White flash effect on deploy.
   */
  flashDeploy() {
    this.deployFlash.setFillStyle(0xDAA520);
    this.deployFlash.setAlpha(0.35);
    this.tweens.add({
      targets: this.deployFlash,
      alpha: 0,
      duration: 100,
      ease: "Power2"
    });
  }

  /**
   * Show victory/defeat overlay.
   */
  showGameOver(result) {
    if (this._gameOverShown) return;
    this._gameOverShown = true;

    if (result === "won") {
      this.gameOverTitle.setText("VICTORY");
      this.gameOverTitle.setTint(0xDAA520);
      this.gameOverSub.setText("ALL TARGETS ELIMINATED");
      this.gameOverSub.setTint(0xC4A265);
      this.gameOverBracketL.setFillStyle(0xDAA520);
      this.gameOverBracketR.setFillStyle(0xDAA520);
      this.gameOverBg.setFillStyle(0x2B1A0E);
      this.gameOverBg.setAlpha(0.8);
    } else {
      this.gameOverTitle.setText("DEFEAT");
      this.gameOverTitle.setTint(0xA33B2A);
      this.gameOverSub.setText("BASE DESTROYED");
      this.gameOverSub.setTint(0xC4A265);
      this.gameOverBracketL.setFillStyle(0xA33B2A);
      this.gameOverBracketR.setFillStyle(0xA33B2A);
      this.gameOverBg.setFillStyle(0x3B2312);
      this.gameOverBg.setAlpha(0.6);
    }

    // Fade in the game over container
    this.tweens.add({
      targets: this.gameOverContainer,
      alpha: 1,
      duration: 600,
      ease: "Power2"
    });

    // Pulsing glow on the title
    this.tweens.add({
      targets: this.gameOverTitle,
      alpha: { from: 1, to: 0.6 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });

    // Animate brackets sliding in
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    this.gameOverBracketL.setPosition(centerX - 70, centerY);
    this.gameOverBracketR.setPosition(centerX + 70, centerY);
    this.tweens.add({
      targets: this.gameOverBracketL,
      x: centerX - 50,
      y: centerY - 30,
      alpha: 0.6,
      duration: 400,
      ease: "Back.easeOut"
    });

    this.tweens.add({
      targets: this.gameOverBracketR,
      x: centerX + 50,
      y: centerY - 30,
      alpha: 0.6,
      duration: 400,
      ease: "Back.easeOut"
    });
  }

  /**
   * Restart the game.
   */
  _restartGame() {
    let sceneManager = this.scene.manager;
    sceneManager.getScenes().forEach(function(scene) {
      let sceneKey = scene.scene.key;
      scene.scene.stop(sceneKey);
    });
    sceneManager.start("TitleScene");
  }

  /**
   * Draw grid lines over the player's deploy zone (y: 115-205, cols: 10, rows: 6).
   */
  _drawGrid() {
    this.gridGraphics.clear();
    this.gridGraphics.lineStyle(0.5, 0xC4A265, 0.2);
    for (let col = 0; col <= 10; col++) {
      this.gridGraphics.lineBetween(col * 16, 115, col * 16, 205);
    }
    for (let row = 0; row <= 6; row++) {
      this.gridGraphics.lineBetween(0, 115 + row * 15, 160, 115 + row * 15);
    }
  }

  /**
   * Play a short tick sound via Web Audio API.
   */
  _playTick() {
    if (!this._tickCtx) {
      this._tickCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = this._tickCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    gain.gain.value = 0.06;
    osc.start(ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);
    osc.stop(ctx.currentTime + 0.03);
  }

  // ── SPECTATOR CHAT PANELS ──

  _createSpectatorPanels() {
    this._leftPanel = this._createPanel('FINE-TUNED', '#DAA520');
    this._rightPanel = this._createPanel('BASE', '#9CA3AF');

    this._leftMessages = [];
    this._rightMessages = [];

    // Panels live directly on the body, positioned in side gutters
    this._leftPanel.el.style.position = 'fixed';
    this._leftPanel.el.style.zIndex = '15';
    this._rightPanel.el.style.position = 'fixed';
    this._rightPanel.el.style.zIndex = '15';

    document.body.appendChild(this._leftPanel.el);
    document.body.appendChild(this._rightPanel.el);

    this._syncSpectatorPanels();

    this._onSpectatorResize = () => this._syncSpectatorPanels();
    window.addEventListener('resize', this._onSpectatorResize);
  }

  _createPanel(title, titleColor) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;border:none;box-sizing:border-box;';
    el.style.background = 'transparent';

    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 10px;font-family:Arial,Helvetica,sans-serif;font-weight:bold;letter-spacing:1.5px;flex-shrink:0;text-transform:uppercase;';
    header.style.color = titleColor;
    header.textContent = title;
    el.appendChild(header);

    const manaText = document.createElement('div');
    manaText.style.cssText = 'padding:4px 10px;font-family:Arial,Helvetica,sans-serif;color:#C47832;flex-shrink:0;';
    el.appendChild(manaText);

    const msgArea = document.createElement('div');
    msgArea.style.cssText = 'flex:1;overflow-y:auto;padding:6px 10px;display:flex;flex-direction:column;justify-content:flex-end;gap:4px;';
    el.appendChild(msgArea);

    return { el, header, manaText, msgArea };
  }

  _syncSpectatorPanels() {
    if (!this.game || !this.game.canvas) return;
    const r = this.game.canvas.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const gap = 12; // gap between canvas edge and panel
    const topY = r.top + 10;
    const panelH = r.height - 20;
    const fontSize = Math.max(11, Math.min(14, vw * 0.012));
    const headerSize = Math.max(13, Math.min(16, vw * 0.014));
    const manaSize = Math.max(10, Math.min(13, vw * 0.011));

    // Left panel: from left edge of viewport to left edge of canvas
    const leftW = Math.max(180, r.left - gap * 2);
    this._leftPanel.el.style.left = gap + 'px';
    this._leftPanel.el.style.right = 'auto';
    this._leftPanel.el.style.top = topY + 'px';
    this._leftPanel.el.style.width = leftW + 'px';
    this._leftPanel.el.style.height = panelH + 'px';
    this._leftPanel.header.style.fontSize = headerSize + 'px';
    this._leftPanel.manaText.style.fontSize = manaSize + 'px';

    // Right panel: from right edge of canvas to right edge of viewport
    const rightW = Math.max(180, vw - r.right - gap * 2);
    this._rightPanel.el.style.left = 'auto';
    this._rightPanel.el.style.right = gap + 'px';
    this._rightPanel.el.style.top = topY + 'px';
    this._rightPanel.el.style.width = rightW + 'px';
    this._rightPanel.el.style.height = panelH + 'px';
    this._rightPanel.header.style.fontSize = headerSize + 'px';
    this._rightPanel.manaText.style.fontSize = manaSize + 'px';

    // Update message font sizes
    const updateMsgFonts = (panel) => {
      const msgs = panel.msgArea.querySelectorAll('.spec-msg');
      msgs.forEach(m => { m.style.fontSize = fontSize + 'px'; });
    };
    updateMsgFonts(this._leftPanel);
    updateMsgFonts(this._rightPanel);
  }

  _addSpectatorMessage(side, text) {
    const panel = side === 'left' ? this._leftPanel : this._rightPanel;
    const messages = side === 'left' ? this._leftMessages : this._rightMessages;
    if (!panel || !text) return;

    const vw = window.innerWidth;
    const fontSize = Math.max(11, Math.min(14, vw * 0.012));

    const msg = document.createElement('div');
    msg.className = 'spec-msg';
    msg.style.cssText = 'color:#F5E6C8;font-family:Arial,Helvetica,sans-serif;padding:6px 8px;opacity:0;transition:opacity 0.3s ease;word-wrap:break-word;white-space:pre-wrap;line-height:1.4;border-radius:3px;background:rgba(43,26,14,0.5);';
    msg.style.fontSize = fontSize + 'px';
    msg.textContent = text;

    panel.msgArea.appendChild(msg);
    messages.push(msg);

    // Trigger fade-in on next frame
    requestAnimationFrame(() => { msg.style.opacity = '1'; });

    // Scroll to bottom
    panel.msgArea.scrollTop = panel.msgArea.scrollHeight;

    // Remove oldest if >8 messages
    while (messages.length > 8) {
      const old = messages.shift();
      old.style.opacity = '0';
      setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 300);
    }
  }

  _updateSpectatorMana() {
    if (!this.isSpectatorMode || !this._leftPanel || !this._rightPanel) return;
    try {
      const playScene = this.scene.get("PlayScene");
      if (!playScene || !playScene.player) return;

      const pMana = playScene.player.manaBank
        ? Math.floor(playScene.player.manaBank.getManaAmount()) : '?';
      const oMana = playScene.opponent && playScene.opponent.manaBank
        ? Math.floor(playScene.opponent.manaBank.getManaAmount()) : '?';

      this._leftPanel.manaText.textContent = 'Mana: ' + pMana + '/10';
      this._rightPanel.manaText.textContent = 'Mana: ' + oMana + '/10';
    } catch (e) { /* not ready */ }
  }

  // Keep UI scene on top
  update(time, delta) {
    if (parseInt(time) % 20 === 0) {
      this.scene.bringToTop();
    }

    // ── Spectator mode: update mana display ──
    if (this.isSpectatorMode) {
      this._updateSpectatorMana();
    }

    // ── Update commander mascot (DOM-based, above HTML text overlay) ──
    if (!this.isSpectatorMode) try {
      const isSpeaking = typeof window !== 'undefined' && window.__ttsSpeaking;
      const isDimmed = this.dimOverlay && this.dimOverlay.alpha > 0.1;
      const shouldShow = isSpeaking || isDimmed;
      const overlay = window.__textOverlay;

      if (shouldShow && !this._mascotVisible && overlay) {
        this._mascotVisible = true;
        overlay.showMascot('assets/mascot-nobg.png', 'assets/mascot-open-nobg.png');
        this.tweens.add({
          targets: this.mascotGlow,
          alpha: 0.9,
          duration: 300,
          ease: "Power2"
        });
      } else if (!shouldShow && this._mascotVisible) {
        this._mascotVisible = false;
        this._mascotMouthOpen = false;
        this._mascotMouthTimer = 0;
        if (overlay) overlay.hideMascot();
        this.tweens.add({
          targets: this.mascotGlow,
          alpha: 0,
          duration: 400,
          ease: "Power2"
        });
      }

      // Mouth animation (only when speaking and visible)
      if (isSpeaking && this._mascotVisible && overlay) {
        this._mascotMouthTimer += delta;
        if (this._mascotMouthTimer >= this._mascotMouthInterval) {
          this._mascotMouthTimer = 0;
          this._mascotMouthOpen = !this._mascotMouthOpen;
        }
        overlay.setMascotMouth(this._mascotMouthOpen);
      } else if (!isSpeaking && this._mascotMouthOpen && overlay) {
        this._mascotMouthOpen = false;
        this._mascotMouthTimer = 0;
        overlay.setMascotMouth(false);
      }
    } catch (e) { /* mascot not ready */ }

    // ── Update transcript display ──
    if (!this.isSpectatorMode) try {
      const transcript = (typeof window !== 'undefined' && window.__currentTranscript) || "";
      if (transcript && transcript !== this._lastTranscriptText) {
        // New transcript text arrived
        this._lastTranscriptText = transcript;
        let display = transcript;
        if (display.length > 25) {
          display = "..." + display.slice(display.length - 22);
        }
        this.transcriptText.setText(display);
        this.transcriptText.setAlpha(0.85);
        this._transcriptFadeTimer = 0;
      } else if (!transcript && this._lastTranscriptText) {
        // Transcript cleared — start fading
        this._lastTranscriptText = "";
        this._transcriptFadeTimer = 0;
      }

      // Fade out transcript over 2 seconds after clearing
      if (!this._lastTranscriptText && this.transcriptText.alpha > 0) {
        this._transcriptFadeTimer += delta;
        const fadeAlpha = 0.85 * Math.max(0, 1 - this._transcriptFadeTimer / 2000);
        this.transcriptText.setAlpha(fadeAlpha);
      }
    } catch (e) { /* transcript not ready */ }

    // ── Update mic activity indicator ──
    if (!this.isSpectatorMode) try {
      const userSpeaking = typeof window !== 'undefined' && window.__userSpeaking;
      if (userSpeaking && !this._micPulseTween) {
        this.micIndicator.setAlpha(0.9);
        this._micPulseTween = this.tweens.add({
          targets: this.micIndicator,
          alpha: { from: 0.9, to: 0.3 },
          duration: 400,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut"
        });
      } else if (!userSpeaking && this._micPulseTween) {
        this._micPulseTween.stop();
        this._micPulseTween = null;
        this.micIndicator.setAlpha(0);
      }
    } catch (e) { /* mic indicator not ready */ }

    try {
      const playScene = this.scene.get("PlayScene");
      if (!playScene || !playScene.sys || !playScene.sys.isActive() || !playScene.player) return;

      // ── Update match timer ──
      if (!this._matchEnded && !this._gameOverShown) {
        this._matchTimerAccum += delta;
        if (this._matchTimerAccum >= 1000) {
          this._matchTimerAccum -= 1000;
          this._matchTime--;
          if (this._matchTime <= 0) {
            this._matchTime = 0;
            this._matchEnded = true;
            // Time's up -- whoever has more towers wins, or defender wins
            const pTowers = playScene.player.towers.children ? playScene.player.towers.getLength() : 0;
            const oTowers = playScene.opponent.towers.children ? playScene.opponent.towers.getLength() : 0;
            if (pTowers >= oTowers) {
              this.showGameOver("won");
            } else {
              this.showGameOver("lost");
            }
          }

          // Double elixir at 1:00
          if (this._matchTime === 60 && !this._doubleElixirShown) {
            this._doubleElixir = true;
            this._doubleElixirShown = true;
            // Flash x2 ELIXIR text
            this.doubleElixirText.setAlpha(1);
            this.tweens.add({
              targets: this.doubleElixirText,
              alpha: 0,
              duration: 2500,
              ease: "Power2"
            });
            // Double the mana regen rate if manaBank supports it
            if (playScene.player.manaBank && playScene.player.manaBank.regenRate !== undefined) {
              playScene.player.manaBank.regenRate *= 2;
            }
            if (playScene.opponent.manaBank && playScene.opponent.manaBank.regenRate !== undefined) {
              playScene.opponent.manaBank.regenRate *= 2;
            }
          }

          // Format timer display
          const mins = Math.floor(this._matchTime / 60);
          const secs = this._matchTime % 60;
          const timerStr = mins + ":" + (secs < 10 ? "0" : "") + secs;
          if (window.__textOverlay && this._timerOverlayId != null) {
            window.__textOverlay.setText(this._timerOverlayId, timerStr);
          }

          // Timer color when <30s or <60s
          if (this._matchTime <= 30 && this._matchTime > 0) {
            if (window.__textOverlay && this._timerOverlayId != null) {
              window.__textOverlay.setColor(this._timerOverlayId, '#A33B2A');
            }
          } else if (this._matchTime <= 60) {
            if (window.__textOverlay && this._timerOverlayId != null) {
              window.__textOverlay.setColor(this._timerOverlayId, '#C47832');
            }
          }
        }
      }

      // (Mana bar is handled by ManaBank's built-in DisplayBar)

      // ── Update deploy queue display (skip in spectator mode) ──
      if (!this.isSpectatorMode) try {
        const queue = (typeof window !== 'undefined' && window.__deployQueue) || [];
        const qLen = queue.length;

        if (qLen !== this._prevQueueLength) {
          this._prevQueueLength = qLen;

          // Stop existing pulse tween
          if (this._queuePulseTween) {
            this._queuePulseTween.stop();
            this._queuePulseTween = null;
          }

          // Clear and rebuild
          this.queueContainer.removeAll(true);
          this._queueSprites = [];

          if (qLen === 0) {
            this.queueLabel.setAlpha(0);
          } else {
            this.queueLabel.setAlpha(0.7);

            const sceneHeight = this.cameras.main.height;
            const startX = 30;
            const startY = sceneHeight - 21;
            const cardW = 12;
            const cardH = 12;
            const gap = 3;
            const maxShow = Math.min(qLen, 5);

            for (let i = 0; i < maxShow; i++) {
              const item = queue[i];
              const cx = startX + i * (cardW + gap);
              const cy = startY;

              // Card background
              const bg = this.add
                .rectangle(cx, cy, cardW, cardH, 0x3B2312)
                .setStrokeStyle(1, i === 0 ? 0xDAA520 : 0xC4A265, 0.8)
                .setOrigin(0, 0);

              // Card name (truncate to 3 chars)
              const name = (item.card || item.name || "?").replace("Troop", "").substring(0, 3).toUpperCase();
              const nameText = this.add
                .bitmapText(cx + cardW / 2, cy + 2, "teeny-tiny-pixls", name, 5)
                .setTint(0xFFF8E7)
                .setOrigin(0.5, 0);

              // Cost text below name
              const costStr = "" + (item.cost !== undefined ? item.cost : "?");
              const costText = this.add
                .bitmapText(cx + cardW / 2, cy + cardH - 4, "teeny-tiny-pixls", costStr, 5)
                .setTint(0xDAA520)
                .setOrigin(0.5, 0);

              // Progressive dimming: front item brightest, rest dimmer
              const alpha = Math.max(0.3, 0.95 - i * 0.15);
              bg.setAlpha(alpha);
              nameText.setAlpha(alpha);
              costText.setAlpha(alpha);

              this.queueContainer.add(bg);
              this.queueContainer.add(nameText);
              this.queueContainer.add(costText);

              if (i === 0) {
                this._queueSprites.push({ bg, nameText, costText });
              }
            }

            // Pulse tween on front-of-queue card
            if (maxShow > 0 && this._queueSprites.length > 0) {
              const front = this._queueSprites[0];
              this._queuePulseTween = this.tweens.add({
                targets: [front.bg, front.nameText, front.costText],
                alpha: { from: 0.95, to: 0.5 },
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut"
              });
            }
          }
        }

        // Every frame: update front card stroke color based on mana
        if (qLen > 0 && this._queueSprites.length > 0) {
          const frontItem = queue[0];
          const frontCost = frontItem.cost !== undefined ? frontItem.cost : 0;
          const playScene = this.scene.get("PlayScene");
          if (playScene && playScene.player && playScene.player.manaBank) {
            const currentMana = Math.floor(playScene.player.manaBank.getManaAmount());
            const strokeColor = currentMana >= frontCost ? 0xDAA520 : 0x5C3A1E;
            this._queueSprites[0].bg.setStrokeStyle(1, strokeColor, 0.8);
          }
        }
      } catch (e) { /* queue display not ready */ }

      // ── Draw health bars on troops and towers ──
      this.healthBars.clear();

      // Helper to draw a single health bar
      const drawHealthBar = (entity, color) => {
        if (!entity || !entity.active) return;
        const hp = entity.currentHealth !== undefined ? entity.currentHealth : entity.health;
        const maxHp = entity.maxHealth || entity.baseHealth || hp;
        if (!hp || hp <= 0 || !maxHp) return;

        const pct = hp / maxHp;
        const barW = entity.isTower ? 20 : 16;
        const x = entity.x - barW / 2;
        const y = entity.y - (entity.isTower ? 16 : 12);

        // Dark brown bg with border
        this.healthBars.fillStyle(0x2B1A0E, 0.7);
        this.healthBars.fillRect(x - 1, y - 1, barW + 2, 4);
        // Colored fill
        this.healthBars.fillStyle(color, 0.9);
        this.healthBars.fillRect(x, y, Math.max(1, Math.floor(barW * pct)), 2);
      };

      // Player troops (arena green)
      if (playScene.player.troops && playScene.player.troops.getChildren) {
        playScene.player.troops.getChildren().forEach(t => drawHealthBar(t, 0x4A7B2D));
      }
      // Opponent troops (clay red)
      if (playScene.opponent && playScene.opponent.troops && playScene.opponent.troops.getChildren) {
        playScene.opponent.troops.getChildren().forEach(t => drawHealthBar(t, 0xA33B2A));
      }
      // Player towers (arena green)
      if (playScene.player.towers && playScene.player.towers.getChildren) {
        playScene.player.towers.getChildren().forEach(t => drawHealthBar(t, 0x4A7B2D));
      }
      // Opponent towers (clay red)
      if (playScene.opponent && playScene.opponent.towers && playScene.opponent.towers.getChildren) {
        playScene.opponent.towers.getChildren().forEach(t => drawHealthBar(t, 0xA33B2A));
      }

      // ── Check for game over ──
      if (!this._gameOverShown) {
        if (playScene.player.towers.getLength() === 0) {
          this.showGameOver("lost");
        } else if (playScene.opponent.towers.getLength() === 0) {
          this.showGameOver("won");
        }
      }
    } catch (e) {
      // PlayScene may not be ready yet
    }
  }
}

export default UIScene;
