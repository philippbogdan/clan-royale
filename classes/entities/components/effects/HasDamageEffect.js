class HasDamageEffect {
  constructor() {
    var attributes = {
      damageAmount: 10
    };

    Object.assign(this, attributes);
    Object.assign(this, this.constructor.methods);
  }
}

HasDamageEffect.methods = {
  // <Setters>
  setDamageAmount(damageAmount) {
    this.damageAmount = damageAmount;
  },
  // </Setters>

  doDamageEffect(target) {
    // Do visual effect on attacker (scale pulse)
    this.scene.tweens.add({
      targets: [this],
      scaleX: 1.1 + this.damageAmount * 0.025,
      scaleY: 1.1 + this.damageAmount * 0.025,
      ease: "Linear",
      duration: 100,
      yoyo: true,
      repeat: 0,
      callbackScope: this
    });

    // Hit flash on target
    if (target && !target.isDestroyed) {
      target.setTintFill(0xffffff);
      target.scene.time.delayedCall(100, () => {
        if (target && !target.isDestroyed) target.clearTint();
      });
    }

    // Floating damage number via HTML overlay
    if (target && !target.isDestroyed) {
      const overlay = window.__textOverlay;
      if (overlay) {
        const ox = (Math.random() - 0.5) * 6;
        overlay.addFloating(target.x + ox, target.y - 10, String(this.damageAmount), {
          fontSize: 8, color: '#ff4444', stroke: '#000000', fontWeight: 'bold'
        });
      }
    }

    // affect health of target here
    target.deductHealth(this.damageAmount);
  },

  /** <Hook into phaser and internal events> */

  // Called when an entity with this component is created
  _init() {
    this.addEffect(this.doDamageEffect);
  },

  // Called when an entity with this component is updated
  _preUpdate(time, delta) {},

  // Called when an entity with this component is destroyed
  _destroy() {}

  /** </Hook into phaser and internal events> */
};

export default HasDamageEffect;
