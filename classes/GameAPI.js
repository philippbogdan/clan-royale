import { getApiUrl } from "../settings/api.js";
import {
  DEFAULT_DEPLOY_Y,
  GAME_WIDTH,
  GRID_CENTER_OFFSET_X,
  GRID_CENTER_OFFSET_Y,
  GRID_COLS,
  GRID_COL_WIDTH,
  GRID_ORIGIN_Y,
  GRID_ROW_HEIGHT,
  GRID_ROWS,
  LEFT_DEPLOY_X,
  MID_X,
  PLAYER_GRID,
  RIGHT_DEPLOY_X
} from "../settings/gameConstants.js";

// GameAPI - Singleton wrapper exposing game internals for AI voice control

class GameAPI {
  constructor(scene) {
    this.scene = scene;
    this.gameStatus = "playing"; // "playing", "won", "lost"
    this._cinematicActive = false;

    // Event system
    this._listeners = [];
    this._pendingEvents = [];

    // Deploy queue for queuing cards when mana is insufficient
    this._deployQueue = [];

    // Recorded decisions for training data (spectator mode)
    this._recordedDecisions = [];

    // Snapshot of tower health for damage detection
    this._lastTowerHealth = this._snapshotTowerHealth();
    this._lastManaFull = false;

    // Listen for game-over conditions (game ends when king tower falls)
    scene.events.on("tower-destroyed", (data) => {
      if (data && data.isKingTower) {
        if (data.owner === scene.player) {
          this.gameStatus = "lost";
          this._emit("game_over", { result: "lost" });
          this._flushRecordedDecisions("lost");
        } else if (data.owner === scene.opponent) {
          this.gameStatus = "won";
          this._emit("game_over", { result: "won" });
          this._flushRecordedDecisions("won");
        }
      }
      this._emit("tower_destroyed", {
        myTowers: scene.player.towers.getLength(),
        opponentTowers: scene.opponent.towers.getLength()
      });
    });

    // Start periodic monitor (every 2.5 seconds)
    scene.time.addEvent({
      delay: 2500,
      loop: true,
      callback: this._monitor,
      callbackScope: this
    });
  }

  // ---- Read-only state ----

  getGameState() {
    const scene = this.scene;
    return {
      mana: Math.floor(scene.player.manaBank.getManaAmount()),
      maxMana: 10,
      hand: this.getHand(),
      myTroops: this._serializeTroops(scene.player),
      opponentTroops: this._serializeTroops(scene.opponent),
      myTowers: this._serializeTowers(scene.player),
      opponentTowers: this._serializeTowers(scene.opponent),
      gameStatus: this.gameStatus,
      queue: this.getQueueState(),
      grid: PLAYER_GRID
    };
  }

  getHand() {
    // In spectator mode, player is a ComputerPlayer with virtual hand
    if (this.scene.player.getVirtualHandState) {
      return this.scene.player.getVirtualHandState();
    }
    const hand = this.scene.player.cardArea.hand;
    const result = [];
    for (let i = 0; i < hand.slots.length; i++) {
      const slot = hand.slots[i];
      if (slot.card && slot.card.troopClass) {
        result.push({
          name: slot.card.troopClass.NAME,
          cost: slot.card.troopClass.COST,
          slotIndex: i
        });
      }
    }
    return result;
  }

  // ---- Actions ----

  playCard(slotIndex, lane, posX, posY) {
    const scene = this.scene;
    const hand = scene.player.cardArea.hand;

    if (slotIndex < 0 || slotIndex >= hand.slots.length) {
      return { success: false, error: "Invalid slot index" };
    }

    const slot = hand.slots[slotIndex];
    if (!slot.card || !slot.card.troopClass) {
      return { success: false, error: "No card in that slot" };
    }

    const troopClass = slot.card.troopClass;
    const x = posX != null ? posX : lane === "left" ? LEFT_DEPLOY_X : RIGHT_DEPLOY_X;
    const y = posY != null ? posY : DEFAULT_DEPLOY_Y;

    // Select the slot so drawNextCard works correctly
    hand.setSelectedCardSlot(slot);

    const spawned = scene.player.spawnTroop(
      x,
      y,
      scene.player.troopVelocityDirection,
      troopClass
    );

    if (spawned) {
      hand.drawNextCard();
      hand.deselectAll();
      scene.opponent.spawnZoneOverlay.setAlpha(0);
      if (window.__playSFX) window.__playSFX('spawn');
      return { success: true, card: troopClass.NAME, lane };
    }

    hand.deselectAll();
    scene.opponent.spawnZoneOverlay.setAlpha(0);
    return { success: false, error: "Not enough mana" };
  }

  playCardByName(name, lane, x, y) {
    const hand = this.scene.player.cardArea.hand;
    for (let i = 0; i < hand.slots.length; i++) {
      const slot = hand.slots[i];
      if (
        slot.card &&
        slot.card.troopClass &&
        slot.card.troopClass.NAME.toLowerCase() === name.toLowerCase()
      ) {
        return this.playCard(i, lane, x, y);
      }
    }
    return { success: false, error: `Card "${name}" not in hand` };
  }

  executeActions(actions) {
    const results = [];
    for (const action of actions) {
      let x = action.x, y = action.y;
      if (action.col != null && action.row != null) {
        const px = GameAPI.gridToPixel(action.col, action.row);
        x = px.x; y = px.y;
      }
      if (action.type === "queue_card") {
        results.push(this.queueCard(action.card, x, y));
      } else if (action.type === "play_card") {
        const lane = action.lane || (x != null && x < MID_X ? "left" : "right");
        const result = this.playCardByName(action.card, lane, x, y);
        if (!result.success && result.error === "Not enough mana") {
          results.push(this.queueCard(action.card, x, y));
        } else {
          results.push(result);
        }
      } else {
        results.push({ success: false, error: `Unknown action type: ${action.type}` });
      }
    }
    return results;
  }

  // ---- Deploy Queue ----

  queueCard(name, x, y) {
    const hand = this.scene.player.cardArea.hand;
    const found = hand.getCardByName(name);
    if (!found) {
      return { success: false, error: "Card not in hand" };
    }

    const { slot } = found;
    const troopClass = slot.card.troopClass;

    // Remove card from hand
    hand.setSelectedCardSlot(slot);
    hand.drawNextCard();
    hand.deselectAll();
    this.scene.opponent.spawnZoneOverlay.setAlpha(0);

    // Create dimmed ghost sprite at target position
    let ghost = null;
    try {
      ghost = this.scene.add.sprite(x, y, troopClass.ANIM_KEY_PREFIX);
      ghost.setAlpha(0.3).setDepth(50).setTint(0x8888ff);
    } catch (e) { /* sprite creation may fail if texture missing */ }

    // Add to queue
    this._deployQueue.push({
      troopClass,
      cost: troopClass.COST,
      x,
      y,
      cardName: troopClass.NAME,
      queuedAt: Date.now(),
      ghost
    });

    return { success: true, card: troopClass.NAME, queued: true, position: this._deployQueue.length };
  }

  processQueue() {
    if (this._deployQueue.length === 0) return null;

    const front = this._deployQueue[0];
    const currentMana = this.scene.player.manaBank.getManaAmount();

    if (currentMana >= front.cost) {
      this._deployQueue.shift();

      // Remove ghost sprite
      if (front.ghost) {
        try { front.ghost.destroy(); } catch (e) { /* ignore */ }
      }

      const spawned = this.scene.player.spawnTroop(
        front.x,
        front.y,
        this.scene.player.troopVelocityDirection,
        front.troopClass
      );

      if (spawned) {
        if (window.__playSFX) window.__playSFX('spawn');
        this._emit("deploy_from_queue", {
          card: front.cardName,
          x: front.x,
          y: front.y,
          queuedAt: front.queuedAt
        });
        return { success: true, card: front.cardName, x: front.x, y: front.y };
      }

      return { success: false, error: "Spawn failed", card: front.cardName };
    }

    return null;
  }

  getQueueState() {
    return this._deployQueue.map((item, i) => ({
      position: i + 1,
      card: item.cardName,
      cost: item.cost,
      x: item.x,
      y: item.y,
      queuedAt: item.queuedAt
    }));
  }

  async cinematicDeploy(actions, reasoning) {
    if (this._cinematicActive) return [];
    this._cinematicActive = true;

    const playScene = this.scene;

    // 1. FREEZE
    playScene.freezeGame();

    // 2. Emit preview data for UIScene
    const previewData = actions.map(a => {
      let x, y;
      if (a.col != null && a.row != null) {
        const px = GameAPI.gridToPixel(a.col, a.row);
        x = px.x; y = px.y;
      } else {
        x = a.lane === "left" ? LEFT_DEPLOY_X : RIGHT_DEPLOY_X;
        y = DEFAULT_DEPLOY_Y;
      }
      return { card: a.card, lane: a.lane || (x < MID_X ? "left" : "right"), x, y };
    });
    playScene.events.emit('tactical-preview', previewData);

    // 3. Speak reasoning via TTS
    if (window.__speakText) {
      window.__speakText(reasoning);
    }

    // 4. Wait for preview to be visible (at least 1s)
    await new Promise(r => setTimeout(r, 1000));

    // 5. Wait until TTS finishes speaking (poll __ttsSpeaking), max 15s safety
    await new Promise(resolve => {
      const startTime = Date.now();
      const check = () => {
        if (!window.__ttsSpeaking || Date.now() - startTime > 15000) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      // Give TTS a moment to start, then begin polling
      setTimeout(check, 500);
    });

    // 6. Brief pause after speech ends before deploying
    await new Promise(r => setTimeout(r, 300));

    // 6b. Card flight animation
    const hand = playScene.player.cardArea.hand;
    const flightData = [];
    let actionIndex = 0;
    for (const action of actions) {
      for (let i = 0; i < hand.slots.length; i++) {
        const slot = hand.slots[i];
        if (slot.card && slot.card.troopClass &&
            slot.card.troopClass.NAME.toLowerCase() === action.card.toLowerCase()) {
          flightData.push({
            card: action.card,
            slotIndex: i,
            textureKey: slot.card.troopClass.ANIM_KEY_PREFIX,
            targetX: previewData[actionIndex].x,
            targetY: previewData[actionIndex].y,
            targetCol: action.col != null ? action.col : (action.lane === 'left' ? 2 : 7),
            targetRow: action.row != null ? action.row : 4
          });
          break;
        }
      }
      actionIndex++;
    }
    if (flightData.length > 0) {
      playScene.events.emit('tactical-card-flight', flightData);
    }
    await new Promise(r => setTimeout(r, 1500));

    // 7. DEPLOY — execute actual card plays
    playScene.events.emit('tactical-deploy');
    const results = this.executeActions(actions);

    // 8. Small delay for deploy animation to land, then UNFREEZE
    await new Promise(r => setTimeout(r, 400));
    playScene.unfreezeGame();

    this._cinematicActive = false;
    return results;
  }

  // ---- Decision recording (spectator mode) ----

  recordDecision(gameState, actions, side) {
    this._recordedDecisions.push({
      timestamp: Date.now(),
      side,
      gameState,
      actions
    });
  }

  _flushRecordedDecisions(result) {
    if (this._recordedDecisions.length === 0) return;

    const entries = this._recordedDecisions.map(d => ({
      ...d,
      gameResult: result
    }));
    // Keep decisions available for Playwright to read after game over
    this._flushedDecisions = entries;
    this._recordedDecisions = [];

    fetch(getApiUrl("/api/record-gameplay"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries })
    }).catch(err => {
      console.error('[GameAPI] Failed to flush recorded decisions:', err);
    });
  }

  // ---- Event system ----

  onGameEvent(callback) {
    this._listeners.push(callback);
  }

  getContextualUpdate() {
    const events = this._pendingEvents.splice(0);
    if (events.length === 0) return null;

    const lines = events.map(e => {
      switch (e.type) {
        case "opponent_push":
          return `Warning: ${e.data.count} enemy troops pushing ${e.data.lane} lane!`;
        case "tower_damage":
          return `Your ${e.data.position} tower took damage! HP: ${e.data.health}/${e.data.maxHealth}`;
        case "tower_destroyed":
          return `A tower was destroyed! You have ${e.data.myTowers} towers, opponent has ${e.data.opponentTowers}.`;
        case "mana_full":
          return "Mana is full at 10! Spend it before it's wasted.";
        case "low_health_tower":
          return `Critical: Your ${e.data.position} tower is low! HP: ${e.data.health}/${e.data.maxHealth}`;
        case "game_over":
          return e.data.result === "won" ? "Victory! All enemy towers destroyed!" : "Defeat! All your towers fell.";
        default:
          return `Event: ${e.type}`;
      }
    });
    return lines.join(" ");
  }

  _emit(type, data) {
    const event = { type, data, timestamp: Date.now() };
    this._pendingEvents.push(event);
    for (const cb of this._listeners) {
      try {
        cb(event);
      } catch (e) {
        console.error("GameAPI event listener error:", e);
      }
    }
  }

  // ---- Periodic monitor ----

  _monitor() {
    if (this.gameStatus !== "playing") return;

    try {
      this._checkOpponentPush();
      this._checkTowerDamage();
      this._checkManaFull();
    } catch (e) {
      console.error("GameAPI monitor error:", e);
    }
  }

  _checkOpponentPush() {
    const scene = this.scene;
    const midX = MID_X;
    let leftCount = 0;
    let rightCount = 0;

    scene.opponent.troops.getChildren().forEach(troop => {
      // Skip towers (they are also in the troops group)
      if (!troop.animKeyPrefix) return;
      if (troop.x < midX) leftCount++;
      else rightCount++;
    });

    if (leftCount >= 3) {
      this._emit("opponent_push", { lane: "left", count: leftCount });
    }
    if (rightCount >= 3) {
      this._emit("opponent_push", { lane: "right", count: rightCount });
    }
  }

  _checkTowerDamage() {
    const scene = this.scene;
    const currentHealth = this._snapshotTowerHealth();
    const prev = this._lastTowerHealth;

    for (const key of Object.keys(currentHealth)) {
      if (prev[key] !== undefined && currentHealth[key] < prev[key]) {
        const position = key; // e.g. "center", "left", "right"
        const health = currentHealth[key];
        const maxHealth = 1000;

        this._emit("tower_damage", { position, health, maxHealth });

        if (health > 0 && health / maxHealth < 0.3) {
          this._emit("low_health_tower", { position, health, maxHealth });
        }
      }
    }

    this._lastTowerHealth = currentHealth;
  }

  _checkManaFull() {
    const mana = this.scene.player.manaBank.getManaAmount();
    const isFull = mana >= 10;

    if (isFull && !this._lastManaFull) {
      this._emit("mana_full", { mana: 10 });
    }
    this._lastManaFull = isFull;
  }

  _snapshotTowerHealth() {
    const snapshot = {};
    const scene = this.scene;

    try {
      const towers = scene.player.towers.getChildren();
      // Map tower positions to labels
      for (const tower of towers) {
        const x = Math.round(tower.x);
        let label;
        if (x <= 50) label = "left";
        else if (x >= 110) label = "right";
        else label = "center";
        snapshot[label] = tower.currentHealth;
      }
    } catch (e) {
      // Towers may not exist yet during init
    }

    return snapshot;
  }

  // ---- Internal helpers ----

  _serializeTroops(player) {
    const troops = [];
    player.troops.getChildren().forEach(troop => {
      // Towers are also in the troops group; skip them
      if (troop.owner && troop.animKeyPrefix) {
        troops.push({
          name: troop.constructor.NAME || troop.animKeyPrefix,
          col: Math.max(0, Math.min(GRID_COLS - 1, Math.floor(troop.x / GRID_COL_WIDTH))),
          row: Math.max(
            0,
            Math.min(
              GRID_ROWS - 1,
              Math.floor((troop.y - GRID_ORIGIN_Y) / GRID_ROW_HEIGHT)
            )
          ),
          health: troop.currentHealth
        });
      }
    });
    return troops;
  }

  _serializeTowers(player) {
    const towers = [];
    player.towers.getChildren().forEach(tower => {
      towers.push({
        col: Math.max(0, Math.min(GRID_COLS - 1, Math.floor(tower.x / GRID_COL_WIDTH))),
        row: Math.max(
          0,
          Math.min(
            GRID_ROWS - 1,
            Math.floor((tower.y - GRID_ORIGIN_Y) / GRID_ROW_HEIGHT)
          )
        ),
        health: tower.currentHealth
      });
    });
    return towers;
  }
}

GameAPI.gridToPixel = function(col, row) {
  return {
    x: Math.max(
      0,
      Math.min(
        GAME_WIDTH - 1,
        col * GRID_COL_WIDTH + GRID_CENTER_OFFSET_X
      )
    ),
    y: Math.max(
      GRID_ORIGIN_Y,
      Math.min(
        GRID_ORIGIN_Y + GRID_ROWS * GRID_ROW_HEIGHT - 1,
        GRID_ORIGIN_Y + row * GRID_ROW_HEIGHT + GRID_CENTER_OFFSET_Y
      )
    )
  };
};

GameAPI.pixelToGrid = function(px, py) {
  const col = Math.round((px - GRID_CENTER_OFFSET_X) / GRID_COL_WIDTH);
  const row = Math.round(
    (py - GRID_ORIGIN_Y - GRID_CENTER_OFFSET_Y) / GRID_ROW_HEIGHT
  );
  return {
    col: Math.max(0, Math.min(GRID_COLS - 1, col)),
    row: Math.max(0, Math.min(GRID_ROWS - 1, row))
  };
};

export default GameAPI;
