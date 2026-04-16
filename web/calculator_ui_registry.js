import { createOpticalAxisUi } from "./cavity_mode_ui.js";
import { createExternalLinkUi } from "./external_link_ui.js";
import { createSimpleCalculatorUi } from "./simple_calculator_ui.js";


export function createCalculatorUiRegistry(dependencies) {
  const fallbackUi = createSimpleCalculatorUi();
  const registeredUis = [
    createExternalLinkUi(),
    createOpticalAxisUi(dependencies),
  ];

  function resolve(context = {}) {
    return registeredUis.find((ui) => ui.matches(context)) || fallbackUi;
  }

  function clearTransientState() {
    for (const ui of [...registeredUis, fallbackUi]) {
      ui.clearTransientState?.();
    }
  }

  return {
    clearTransientState,
    resolve,
  };
}
