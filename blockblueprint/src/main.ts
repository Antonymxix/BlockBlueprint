import { generate, GenResult } from './gen/generate';
import { Params, PRESETS, STYLE_IDS, ROOF_IDS, SHAPE_IDS, StyleId, defaultParams } from './gen/params';
import { exportSchematic } from './export/schematic';
import { parsePrompt } from './parser';
import { Preview } from './render/scene';
import { TABLE } from './core/blocks';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const preview = new Preview($('view') as HTMLCanvasElement);
let params: Params = defaultParams('medieval', 7);
let result: GenResult;
(window as unknown as { __bb: unknown }).__bb = { preview, get result() { return result; } };

function fillSelect(id: string, ids: readonly string[]) {
  const el = $<HTMLSelectElement>(id);
  el.innerHTML = ids.map((i) => `<option value="${i}">${i}</option>`).join('');
}
fillSelect('roof', ROOF_IDS);
fillSelect('shape', SHAPE_IDS);

const stylesEl = $('styles');
stylesEl.innerHTML = STYLE_IDS.map((id) => `<button class="card" data-id="${id}"><b>${PRESETS[id].label}</b><small>${PRESETS[id].blurb}</small></button>`).join('');
stylesEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button.card') as HTMLElement | null;
  if (!b) return;
  params = { ...defaultParams(b.dataset.id as StyleId, params.seed) };
  syncUi();
  run(true);
});

const sliders = ['floors', 'width', 'depth', 'towers'] as const;
function syncUi() {
  for (const k of sliders) {
    $<HTMLInputElement>(k).value = String(params[k]);
    $(`v-${k}`).textContent = String(params[k]);
  }
  $<HTMLInputElement>('glass').value = String(Math.round(params.glass * 100));
  $('v-glass').textContent = Math.round(params.glass * 100) + '%';
  $<HTMLSelectElement>('roof').value = params.roof;
  $<HTMLSelectElement>('shape').value = params.shape;
  for (const k of ['garden', 'pool', 'interior', 'ground'] as const) $<HTMLInputElement>(k).checked = params[k];
  $('seed').textContent = String(params.seed);
  stylesEl.querySelectorAll('button.card').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === params.style));
}

let timer = 0;
function run(animate = false) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const t0 = performance.now();
    result = generate(params);
    preview.setHouse(result.grid, result.origin);
    if (animate) preview.playBuild(6);
    const g = result.grid;
    $('info').textContent = `${result.info.blocks.toLocaleString()} blocks · ${g.w}×${g.h}×${g.l} · ${result.info.levels} levels · generated in ${Math.round(performance.now() - t0)} ms (mesh ${Math.round(preview.stats.ms)} ms)`;
    const counts = new Map<string, number>();
    for (let i = 0; i < g.data.length; i++) if (g.data[i]) counts.set(TABLE.base(g.data[i]), (counts.get(TABLE.base(g.data[i])) ?? 0) + 1);
    $('materials').innerHTML = [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span>${k.replace(/_/g, ' ')}</span><span>${v}</span></div>`).join('');
  }, 30);
}

for (const k of sliders)
  $<HTMLInputElement>(k).addEventListener('input', (e) => {
    params = { ...params, [k]: Number((e.target as HTMLInputElement).value) };
    syncUi();
    run();
  });
$<HTMLInputElement>('glass').addEventListener('input', (e) => {
  params = { ...params, glass: Number((e.target as HTMLInputElement).value) / 100 };
  syncUi();
  run();
});
$<HTMLSelectElement>('roof').addEventListener('change', (e) => {
  params = { ...params, roof: (e.target as HTMLSelectElement).value as Params['roof'] };
  run(true);
});
$<HTMLSelectElement>('shape').addEventListener('change', (e) => {
  params = { ...params, shape: (e.target as HTMLSelectElement).value as Params['shape'] };
  run(true);
});
for (const k of ['garden', 'pool', 'interior', 'ground'] as const)
  $<HTMLInputElement>(k).addEventListener('change', (e) => {
    params = { ...params, [k]: (e.target as HTMLInputElement).checked };
    run();
  });

$('dice').addEventListener('click', () => {
  params = { ...params, seed: Math.floor(Math.random() * 99999) };
  syncUi();
  run(true);
});
function fromPrompt() {
  const text = $<HTMLTextAreaElement>('prompt').value;
  const r = parsePrompt(text, params.seed);
  params = r.params;
  $('chips').innerHTML = r.matched.map((m) => `<span class="chip">${m}</span>`).join('');
  syncUi();
  run(true);
}
$('go').addEventListener('click', fromPrompt);
$('prompt').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
    e.preventDefault();
    fromPrompt();
  }
});

const time = $<HTMLInputElement>('time');
function showTime() {
  const h = Number(time.value);
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  $('v-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
time.value = '15.5';
time.addEventListener('input', () => {
  preview.setTime(Number(time.value));
  showTime();
});
preview.setTime(15.5);
showTime();

$('build').addEventListener('click', () => preview.playBuild(7));
$('rotate').addEventListener('click', () => (preview.controls.autoRotate = !preview.controls.autoRotate));
$('shot').addEventListener('click', async () => {
  const blob = await preview.screenshot();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `blockblueprint-${params.style}-${params.seed}.png`;
  a.click();
});

async function download(version: 2 | 3) {
  const data = await exportSchematic(result.grid, { version, name: `${params.style}_${params.seed}`, author: 'BlockBlueprint', origin: result.origin });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  a.download = `${params.style}_${params.seed}_v${version}.schem`;
  a.click();
}
$('dl3').addEventListener('click', () => download(3));
$('dl2').addEventListener('click', () => download(2));

syncUi();
run(true);
