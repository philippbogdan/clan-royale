// Represents game object which holds cards drawn from a deck and placed into a hand
// Then cards are played onto the field, which spawns troops

import Phaser from "phaser";

class Card extends Phaser.GameObjects.Container {
  constructor(scene, x, y, troopClass) {
    super(scene, x, y);

    this.troopClass = troopClass;
    this.width = 25;
    this.height = 25;

    this.isSelected = false;

    // Add to rendering engine
    scene.add.existing(this).setDepth(10000);

    // Add background
    this.background = scene.add
      .rectangle(0, 0, this.width, this.height, 0xbbbbbb)
      .setOrigin(0, 0);
    this.add(this.background);

    // Add troop image
    const animKey = troopClass.ANIM_KEY_PREFIX;
    const name = troopClass.NAME;
    const cost = troopClass.COST;
    this.add(scene.add.sprite(this.width / 2, this.height / 2, animKey));

    // Mana cost tracked for HTML overlay (smooth text)
    this._costOverlayId = null;
    this._costValue = cost;
  }

  // Called by Hand.updateOverlays with pre-computed world position
  syncCostOverlay(worldX, worldY) {
    const overlay = window.__textOverlay;
    if (!overlay) return;
    if (this._costOverlayId == null) {
      this._costOverlayId = overlay.add(worldX, worldY, String(this._costValue), {
        fontSize: 5, color: '#4444ff', stroke: '#000000', fontWeight: 'bold', fontFamily: '"Press Start 2P", monospace'
      });
    } else {
      overlay.setPosition(this._costOverlayId, worldX, worldY);
    }
  }

  destroy() {
    if (window.__textOverlay && this._costOverlayId != null) {
      window.__textOverlay.remove(this._costOverlayId);
      this._costOverlayId = null;
    }
    super.destroy();
  }
}

export default Card;
