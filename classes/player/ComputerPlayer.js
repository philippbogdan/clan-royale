import Player from "./Player.js";
import ManaBank from "../ManaBank.js";
import { Walkers } from "../entities/troops";

export default class ComputerPlayer extends Player {
  constructor(scene, side) {
    const worldWidth = scene.physics.world.bounds.width;
    const worldHeight = scene.physics.world.bounds.height;
    const halfWorldWidth = worldWidth / 2;
    const halfWorldHeight = worldHeight / 2;

    if (side === 'bottom') {
      // Player-side AI: spawns in bottom half, tower at bottom, troops move up
      super(scene, 0, halfWorldHeight, halfWorldWidth, worldHeight - 10, -1);
    } else {
      // Opponent-side AI (default): spawns in top half, tower at top, troops move down
      super(scene, 0, 0, halfWorldWidth, 30, 1);
    }
    this.side = side || 'top';

    // <ManaBank>
    this.manaBank = new ManaBank(scene, 0, 0, 10, 10, 10);
    // </ManaBank>

    // Build virtual hand from deck-eligible troops
    const deckTroops = Object.values(Walkers).filter(t => t.IS_IN_DECK);
    this.virtualDeck = this._shuffle([...deckTroops]);
    this.virtualHand = this.virtualDeck.splice(0, 4);

    this.decisionInterval = scene.time.addEvent({
      delay: 250,
      callback: this.makeDecision,
      callbackScope: this,
      loop: true
    });
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  _drawNextVirtualCard() {
    if (this.virtualDeck.length === 0) {
      // Reshuffle all deck-eligible troops minus what's in hand
      const deckTroops = Object.values(Walkers).filter(t => t.IS_IN_DECK);
      const handNames = new Set(this.virtualHand.map(t => t.NAME));
      this.virtualDeck = this._shuffle(deckTroops.filter(t => !handNames.has(t.NAME)));
    }
    return this.virtualDeck.pop();
  }

  getVirtualHandState() {
    return this.virtualHand.map((troopClass, i) => ({
      name: troopClass.NAME,
      cost: troopClass.COST,
      slotIndex: i
    }));
  }

  spawnTroopByName(name, x, y) {
    const idx = this.virtualHand.findIndex(t => t.NAME.toLowerCase() === name.toLowerCase());
    if (idx === -1) return false;
    const troopClass = this.virtualHand[idx];
    if (this.manaBank.getManaAmount() < troopClass.COST) return false;
    this.spawnTroop(x, y, this.troopVelocityDirection, troopClass, true);
    this.virtualHand.splice(idx, 1);
    this.virtualHand.push(this._drawNextVirtualCard());
    return true;
  }

  makeDecision() {
    // In spectator mode, AI decisions come from the server
    if (window.gameMode === 'spectator') return;

    const manaAmount = this.manaBank.getManaAmount();

    // TODO: Use Phaser built in randomization
    if (manaAmount >= 3) {
      if (Math.random() < 0.25) {
        // 25% chance that we'll spawn an enemy
        this.spawnTroop(
          parseInt(Math.random() * this.scene.game.config.width, 0),
          50,
          this.troopVelocityDirection
        );
      }
    }
  }

  destroy() {
    this.decisionInterval.remove();
    super.destroy();
  }
}
