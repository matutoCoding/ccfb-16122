// 极简 DOM 构建辅助(无框架依赖, 减少构建面)
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v as string;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v !== undefined && v !== null) {
      (el as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement) {
  el.replaceChildren();
}

export function labeledField(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, [h('span', { class: 'field-label' }, [label]), input]);
}

export function numberInput(value: number, step: number, onChange: (v: number) => void, min?: number, max?: number): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    step: String(step),
    value: String(Math.round(value * 1000) / 1000),
  });
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return input;
}

export function slider(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => onChange(Number(input.value)));
  return input;
}

export function selectInput<T extends string>(
  value: T,
  options: { value: T; label: string }[],
  onChange: (v: T) => void,
): HTMLSelectElement {
  const sel = h('select');
  for (const o of options) {
    sel.append(h('option', { value: o.value, selected: o.value === value }, [o.label]));
  }
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  return h('button', { class: `btn btn-${kind}`, onclick: onClick }, [label]);
}

export function table(headers: string[], rows: (string | HTMLElement)[][]): HTMLElement {
  const thead = h('thead', {}, [h('tr', {}, headers.map((x) => h('th', {}, [x])))]);
  const tbody = h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, [c])))));
  return h('table', { class: 'data-table' }, [thead, tbody]);
}

export function badge(text: string, tone: 'ok' | 'bad' | 'warn' | 'info'): HTMLElement {
  return h('span', { class: `badge badge-${tone}` }, [text]);
}
