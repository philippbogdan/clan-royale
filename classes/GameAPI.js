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
    window.__deployQueue = this._deployQueue;

    // Snapshot of tower health for damage detection
    this._lastTowerHealth = this._snapshotTowerHealth();
    this._lastManaFull = false;

    // Listen for game-over conditions
    scene.events.on("tower-destroyed", () => {
      if (scene.player.towers.getLength() === 0) {
        this.gameStatus = "lost";
        this._emit("game_over", { result: "lost" });
      } else if (scene.opponent.towers.getLength() === 0) {
        this.gameStatus = "won";
        this._emit("game_over", { result: "won" });
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
      queue: this.getQueueState()
    };
  }

  getHand() {
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
    const x = posX != null ? posX : (lane === "left" ? 40 : 120);
    const y = posY != null ? posY : 180;

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
      if (action.type === "queue_card") {
        results.push(this.queueCard(action.card, action.x, action.y));
      } else if (action.type === "play_card") {
        const cardName = action.card;
        const lane = action.lane || "left";
        results.push(this.playCardByName(cardName, lane, action.x, action.y));
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

    // Add to queue
    this._deployQueue.push({
      troopClass,
      cost: troopClass.COST,
      x,
      y,
      cardName: troopClass.NAME,
      queuedAt: Date.now()
    });
    window.__deployQueue = this._deployQueue;

    return { success: true, card: troopClass.NAME, queued: true, position: this._deployQueue.length };
  }

  processQueue() {
    if (this._deployQueue.length === 0) return null;

    const front = this._deployQueue[0];
    const currentMana = this.scene.player.manaBank.getManaAmount();

    if (currentMana >= front.cost) {
      this._deployQueue.shift();
      window.__deployQueue = this._deployQueue;

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
    const previewData = actions.map(a => ({
      card: a.card,
      lane: a.lane,
      x: a.lane === 'left' ? 40 : 120,
      y: 180
    }));
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

    // 7. DEPLOY — execute actual card plays
    playScene.events.emit('tactical-deploy');
    const results = this.executeActions(actions);

    // 8. Small delay for deploy animation to land, then UNFREEZE
    await new Promise(r => setTimeout(r, 400));
    playScene.unfreezeGame();

    this._cinematicActive = false;
    return results;
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
    const midX = 80; // half of 160px canvas width
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
          name: troop.animKeyPrefix,
          x: Math.round(troop.x),
          y: Math.round(troop.y),
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
        x: Math.round(tower.x),
        y: Math.round(tower.y),
        health: tower.currentHealth
      });
    });
    return towers;
  }
}

export default GameAPI;
