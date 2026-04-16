export function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}


export function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.html !== undefined) {
    node.innerHTML = options.html;
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value));
      }
    }
  }
  if (options.children) {
    node.append(...options.children);
  }
  return node;
}


export function getValueByPath(target, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), target);
}


export function setValueByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}


export function optionsForField(field, calculatorState) {
  if (field.options_source === "elements") {
    return (calculatorState.elements || []).map((item) => ({
      value: item.id,
      label: item.label,
    }));
  }
  return field.options || [];
}


export function formatNumber(value, digits = 3) {
  return Number(value).toFixed(digits);
}


export function formatCompactNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  const rounded = Number(number.toFixed(digits));
  return String(rounded);
}


export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}


export function linspace(start, stop, count) {
  if (count <= 1) {
    return [start];
  }
  const values = [];
  const step = (stop - start) / (count - 1);
  for (let index = 0; index < count; index += 1) {
    values.push(start + step * index);
  }
  return values;
}


export function hexToRgba(hexColor, alpha) {
  const hex = hexColor.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((part) => part + part).join("")
    : hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}


export function renderField(field, value, onChange, calculatorState) {
  const wrapper = element("div", { className: "field" });
  const label = element("label", {
    className: "field-label",
    children: [
      element("span", { text: field.label }),
      element("span", { className: "field-unit", text: field.unit || "" }),
    ],
  });
  wrapper.append(label);

  if (field.type === "range_number") {
    const row = element("div", { className: "range-number" });
    const rangeInput = element("input", {
      attrs: {
        type: "range",
        min: field.min,
        max: field.max,
        step: field.step || 0.01,
        value,
      },
    });
    const numberInput = element("input", {
      attrs: {
        type: "number",
        min: field.min,
        max: field.max,
        step: field.step || 0.01,
        value,
      },
    });
    const syncValue = (rawValue) => {
      const nextValue = Number(rawValue);
      rangeInput.value = String(nextValue);
      numberInput.value = String(nextValue);
      onChange(nextValue);
    };
    rangeInput.addEventListener("input", () => syncValue(rangeInput.value));
    numberInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        numberInput.blur();
      }
    });
    numberInput.addEventListener("change", () => syncValue(numberInput.value));
    numberInput.addEventListener("blur", () => syncValue(numberInput.value));
    row.append(rangeInput, numberInput);
    wrapper.append(row);
    return wrapper;
  }

  if (field.type === "number") {
    const input = element("input", {
      attrs: {
        type: "number",
        step: field.step || 0.01,
        value,
      },
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
    input.addEventListener("change", () => onChange(Number(input.value)));
    input.addEventListener("blur", () => onChange(Number(input.value)));
    wrapper.append(input);
    return wrapper;
  }

  if (field.type === "text") {
    const input = element("input", {
      attrs: {
        type: "text",
        value: value || "",
      },
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
    input.addEventListener("change", () => onChange(input.value));
    input.addEventListener("blur", () => onChange(input.value));
    wrapper.append(input);
    return wrapper;
  }

  if (field.type === "select") {
    const select = element("select");
    const options = optionsForField(field, calculatorState);
    for (const option of options) {
      const optionNode = element("option", {
        text: option.label,
        attrs: { value: option.value },
      });
      if (option.value === value) {
        optionNode.selected = true;
      }
      select.append(optionNode);
    }
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(select);
    return wrapper;
  }

  return wrapper;
}
