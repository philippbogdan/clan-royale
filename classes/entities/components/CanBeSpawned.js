class CanBeSpawned {
  constructor() {
    var attributes = {
      cost: 3
    };

    Object.assign(this, attributes);
    Object.assign(this, this.constructor.methods);
  }
}

CanBeSpawned.methods = {
  spawn(x, y) {},

  // <Setters>
  setCost(cost) {
    this.cost = cost;
  },
  // </Setters>

  _init() {
    const targetY = this.y;
    this.y = targetY - 15;
    this.setScale(0.5);
    this.setAlpha(0);

    this.scene.tweens.add({
      targets: this,
      y: targetY,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 400,
      ease: 'Bounce.easeOut'
    });

    // Spawn SFX is played from GameAPI on deliberate player deploys only
  }
};

export default CanBeSpawned;
