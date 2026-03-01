class HasHealth {
  constructor() {
    var attributes = {
      currentHealth: 100,
      overallHealth: 100,
      _healthOverlayId: null
    };

    Object.assign(this, attributes);
    Object.assign(this, this.constructor.methods);
  }
}

HasHealth.methods = {
  // <Setters>
  setCurrentHealth(health) {
    this.currentHealth = health;
    this.updateHealthDisplay();
  },

  setOverallHealth(health) {
    this.currentHealth = health;
    this.overallHealth = health;
    this.updateHealthDisplay();
  },
  // </Setters>

  deductHealth(amount) {
    this.currentHealth -= amount;
    this.updateHealthDisplay();
    this.checkIfDead();
  },

  initHealthBar() {
    const overlay = window.__textOverlay;
    if (overlay) {
      this._healthOverlayId = overlay.add(this.x, this.y - this.height, String(this.currentHealth), {
        fontSize: 7, color: '#ffffff', stroke: '#000000', fontWeight: 'bold'
      });
    }
  },

  updateHealthDisplay() {
    if (window.__textOverlay && this._healthOverlayId != null) {
      window.__textOverlay.setText(this._healthOverlayId, String(this.currentHealth));
    }
  },

  checkIfDead() {
    if (this.currentHealth <= 0) this.destroy();
  },

  // <Hook into phaser and internal events>

  // Called when an entity with this component is created
  _init() {
    this.initHealthBar(); // From HasHealth component
  },

  // Called when an entity with this component is updated
  _preUpdate() {
    if (window.__textOverlay && this._healthOverlayId != null) {
      window.__textOverlay.setPosition(this._healthOverlayId, this.x, this.y - this.height);
    }
  },

  // Called when an entity with this component is destroyed
  _destroy() {
    if (window.__textOverlay && this._healthOverlayId != null) {
      window.__textOverlay.remove(this._healthOverlayId);
      this._healthOverlayId = null;
    }
  }
  // </Hook into phaser and internal events>
};

export default HasHealth;
