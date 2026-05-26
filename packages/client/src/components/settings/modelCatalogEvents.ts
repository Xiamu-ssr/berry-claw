export function emitModelCatalogChanged() {
  window.dispatchEvent(new CustomEvent('berry-claw:models-changed'));
}
