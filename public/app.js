import { parseOcr, fitScale, isOutsideImage, drawWords } from './ocr.js';

const $ = (id) => document.getElementById(id);
const state = {
  image: null,
  imageUrl: '',
  imageName: '',
  data: null,
  items: [],
  mode: 'overlay',
  color: '#1677ff',
  opacity: 1,
  bounds: false,
  selected: -1,
  scale: 1,
  fitting: true,
};
const viewport = $('viewport');
const dialog = $('import-dialog');
const modeLabels = {
  overlay: ['OVERLAY / 叠加对比', '原图 + 识别文字'],
  text: ['OCR RESULT / 识别结果', '按原始坐标还原文字'],
  original: ['ORIGINAL / 原始图像', '查看原始图像'],
  split: ['ORIGINAL / 原始图像', '原图与识别结果同步对照'],
};
let draftImage = null;
let toastTimer;
let drag = null;
let loadVersion = 0;
let jsonReadVersion = 0;

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error('无法读取这张图片，请选择 PNG、JPG 或其他浏览器支持的图片。');
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('图片尺寸无效，请重新选择原始图像。');
  }
  return image;
}

function renderCanvas(canvas, mode) {
  if (!state.image) return;
  const width = state.image.naturalWidth;
  const height = state.image.naturalHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  if (mode !== 'text') context.drawImage(state.image, 0, 0);
  if (mode !== 'original') {
    drawWords(context, state.items, { color: state.color, opacity: state.opacity });
  }
}

function draw() {
  renderCanvas($('primary-canvas'), state.mode === 'split' ? 'original' : state.mode);
  if (state.mode === 'split') renderCanvas($('secondary-canvas'), 'text');
}

function renderRegions() {
  for (const containerId of ['primary-regions', 'secondary-regions']) {
    const container = $(containerId);
    const fragment = document.createDocumentFragment();
    state.items.forEach((item, index) => {
      const region = document.createElement('button');
      region.type = 'button';
      region.className = 'region';
      region.dataset.index = index;
      region.tabIndex = -1;
      region.setAttribute('aria-label', `区域 ${index + 1}：${item.words || '空文字'}`);
      region.setAttribute('aria-pressed', 'false');
      region.title = `${item.words}\nX ${item.location.left} · Y ${item.location.top} · ${item.location.width} × ${item.location.height}`;
      const { left, top, width, height } = item.location;
      region.style.left = `${left / state.image.naturalWidth * 100}%`;
      region.style.top = `${top / state.image.naturalHeight * 100}%`;
      region.style.width = `${width / state.image.naturalWidth * 100}%`;
      region.style.height = `${height / state.image.naturalHeight * 100}%`;
      fragment.append(region);
    });
    container.replaceChildren(fragment);
    container.classList.toggle('show-bounds', state.bounds);
  }
}

function renderResults() {
  const query = $('search').value.toLocaleLowerCase().trim();
  const fragment = document.createDocumentFragment();
  let count = 0;
  state.items.forEach((item, index) => {
    if (query && !item.words.toLocaleLowerCase().includes(query)) return;
    count++;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `result-row${state.selected === index ? ' selected' : ''}`;
    row.dataset.index = index;
    row.setAttribute('aria-pressed', String(state.selected === index));
    row.title = item.words;
    const number = document.createElement('span');
    number.className = 'row-index';
    number.textContent = String(index + 1).padStart(3, '0');
    const words = document.createElement('span');
    words.className = 'row-text';
    words.textContent = item.words || '（空文字）';
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.classList.add('row-arrow');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-chevron');
    arrow.append(use);
    row.append(number, words, arrow);
    fragment.append(row);
  });
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'no-results';
    empty.textContent = query ? '没有找到匹配的识别文字' : '这份 JSON 中没有识别区域';
    fragment.append(empty);
  }
  $('results-list').replaceChildren(fragment);
  $('result-count').textContent = query ? `${count} / ${state.items.length}` : state.items.length;
}

function selectItem(index, { center = false, fromCanvas = false } = {}) {
  state.selected = index;
  document.querySelectorAll('.result-row, .region').forEach((element) => {
    const selected = Number(element.dataset.index) === index;
    element.classList.toggle('selected', selected);
    element.setAttribute('aria-pressed', String(selected));
  });
  const item = state.items[index];
  $('selected-index').textContent = item ? `REGION ${String(index + 1).padStart(3, '0')}` : '点击文字查看';
  $('selected-text').textContent = item ? item.words || '（空文字）' : '选择一个识别区域，检查文字与原图位置。';
  $('coordinates').hidden = !item;
  $('coordinates').replaceChildren();
  if (!item) return;
  for (const [key, label] of [['left', 'X 坐标'], ['top', 'Y 坐标'], ['width', '宽度 W'], ['height', '高度 H']]) {
    const field = document.createElement('div');
    field.className = 'coordinate';
    const name = document.createElement('span');
    name.textContent = label;
    field.append(name, document.createTextNode(item.location[key]));
    $('coordinates').append(field);
  }
  if (fromCanvas) {
    const row = $('results-list').querySelector(`[data-index="${index}"]`);
    if (row) {
      const list = $('results-list');
      list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 2 + row.offsetHeight / 2;
    }
  }
  if (center) {
    const region = $('primary-regions').children[index];
    const rect = region.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    viewport.scrollTo({
      left: viewport.scrollLeft + rect.left - view.left + rect.width / 2 - viewport.clientWidth / 2,
      top: viewport.scrollTop + rect.top - view.top + rect.height / 2 - viewport.clientHeight / 2,
      behavior: 'auto',
    });
  }
}

function setScale(scale, anchor) {
  if (!state.image) return;
  const paper = $('primary-paper');
  const oldRect = paper.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  const point = anchor || { x: view.left + viewport.clientWidth / 2, y: view.top + viewport.clientHeight / 2 };
  const imagePoint = { x: (point.x - oldRect.left) / state.scale, y: (point.y - oldRect.top) / state.scale };
  state.scale = Math.min(4, Math.max(0.001, scale));
  const width = state.image.naturalWidth * state.scale;
  const height = state.image.naturalHeight * state.scale;
  for (const id of ['primary-paper', 'secondary-paper']) {
    $(id).style.width = `${width}px`;
    $(id).style.height = `${height}px`;
  }
  $('zoom-actual').textContent = `${Math.round(state.scale * 1000) / 10}%`;
  const newRect = paper.getBoundingClientRect();
  viewport.scrollLeft += newRect.left + imagePoint.x * state.scale - point.x;
  viewport.scrollTop += newRect.top + imagePoint.y * state.scale - point.y;
}

function fit() {
  if (!state.image) return;
  state.fitting = true;
  const count = state.mode === 'split' ? 2 : 1;
  const availableWidth = Math.max(1, (viewport.clientWidth - 88 - (count - 1) * 28) / count);
  const availableHeight = Math.max(1, viewport.clientHeight - 84);
  setScale(fitScale(state.image.naturalWidth, state.image.naturalHeight, availableWidth, availableHeight));
  viewport.scrollTo(0, 0);
}

function changeMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.view-tab').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('secondary-wrap').hidden = mode !== 'split';
  $('primary-label').textContent = modeLabels[mode][0];
  $('mode-note').lastChild.textContent = modeLabels[mode][1];
  const original = mode === 'original';
  $('text-color').disabled = original;
  $('opacity').disabled = original;
  draw();
  if (state.fitting) fit();
}

function applyDocument({ image, imageUrl, name, parsed, example = false }) {
  const previousUrl = state.imageUrl;
  Object.assign(state, {
    image, imageUrl, imageName: name,
    data: parsed.data, items: parsed.items, selected: -1,
  });
  if (previousUrl.startsWith('blob:') && previousUrl !== imageUrl) URL.revokeObjectURL(previousUrl);
  $('document-thumbnail').src = imageUrl;
  $('image-name').textContent = name;
  $('image-name').title = name;
  $('image-dimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
  $('document-tag').textContent = example ? '示例' : '已导入';
  $('word-count').textContent = parsed.items.length;
  $('search').value = '';
  $('loading').hidden = true;
  renderRegions();
  renderResults();
  selectItem(-1);
  draw();
  fit();
  const outside = state.items.filter((item) => isOutsideImage(item, image.naturalWidth, image.naturalHeight)).length;
  $('status-text').textContent = outside
    ? `${state.items.length} 个区域 · ${outside} 个超出原图边界，请检查图片与坐标是否匹配`
    : `${example ? '示例文档' : '文档'}已就绪 · ${state.items.length} 个识别区域`;
}

async function loadExample() {
  const version = ++loadVersion;
  try {
    const [image, response] = await Promise.all([loadImage('./example.png'), fetch('./example.json')]);
    if (!response.ok) throw new Error('无法载入示例 JSON。');
    const parsed = parseOcr(await response.text());
    if (version !== loadVersion) return;
    applyDocument({
      image, imageUrl: './example.png', name: '幼稚园普法讲座报名表.png', parsed, example: true,
    });
  } catch (error) {
    if (version !== loadVersion) return;
    $('loading').hidden = true;
    $('status-text').textContent = '请导入原图与 OCR JSON 开始对比';
    notify(error.message);
  }
}

function openImport() {
  draftImage = null;
  $('image-file').value = '';
  $('json-file').value = '';
  $('image-file-label').textContent = state.image ? state.imageName : '点击选择，或拖入原始图像';
  $('image-file-detail').textContent = state.image ? '已使用当前原图 · 点击或拖入新图片更换' : '使用图片的原始尺寸匹配 OCR 坐标';
  $('json-input').value = state.data ? JSON.stringify(state.data, null, 2) : '';
  $('json-file-label').textContent = '识别数据.json';
  $('import-error').hidden = true;
  dialog.showModal();
}

function importError(message) {
  $('import-error').textContent = message;
  $('import-error').hidden = false;
}

function chooseImage(file) {
  if (!file) return;
  draftImage = file;
  $('image-file-label').textContent = file.name;
  $('image-file-detail').textContent = `${(file.size / 1024).toFixed(1)} KB · 点击或拖入图片重新选择`;
  $('import-error').hidden = true;
}

$('open-import').addEventListener('click', openImport);
$('change-document').addEventListener('click', openImport);
$('load-example').addEventListener('click', () => {
  void loadExample();
});
$('close-import').addEventListener('click', () => dialog.close());
$('cancel-import').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
});
$('image-file').addEventListener('change', (event) => chooseImage(event.target.files[0]));
$('image-drop').addEventListener('dragover', (event) => {
  event.preventDefault();
  $('image-drop').classList.add('drag-over');
});
$('image-drop').addEventListener('dragleave', () => $('image-drop').classList.remove('drag-over'));
$('image-drop').addEventListener('drop', (event) => {
  event.preventDefault();
  $('image-drop').classList.remove('drag-over');
  chooseImage(event.dataTransfer.files[0]);
});
$('json-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const version = ++jsonReadVersion;
  $('apply-import').disabled = true;
  try {
    const text = await file.text();
    if (version !== jsonReadVersion) return;
    $('json-input').value = text.replace(/^\uFEFF/, '');
    $('json-file-label').textContent = file.name;
    $('import-error').hidden = true;
  } catch {
    importError('无法读取 JSON 文件，请重试或直接粘贴内容。');
  } finally {
    if (version === jsonReadVersion) $('apply-import').disabled = false;
  }
});
$('import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('apply-import');
  button.disabled = true;
  let newUrl;
  try {
    if (!draftImage && !state.image) throw new Error('请先选择一张原始图像。');
    if (!$('json-input').value.trim()) throw new Error('请选择 JSON 文件，或粘贴 OCR 识别结果。');
    const parsed = parseOcr($('json-input').value);
    const file = draftImage;
    let image = state.image;
    if (file) {
      newUrl = URL.createObjectURL(file);
      image = await loadImage(newUrl);
    }
    ++loadVersion;
    applyDocument({
      image, imageUrl: newUrl || state.imageUrl,
      name: file?.name || state.imageName, parsed,
    });
    newUrl = undefined;
    dialog.close();
    document.body.classList.remove('mobile-sidebar-open');
    notify('导入成功，可以开始对比了');
  } catch (error) {
    if (newUrl) URL.revokeObjectURL(newUrl);
    importError(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('.view-tab').forEach((button) => {
  button.addEventListener('click', () => changeMode(button.dataset.mode));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('.view-tab')];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    changeMode(tabs[next].dataset.mode);
    tabs[next].focus();
  });
});
$('text-color').addEventListener('input', (event) => {
  state.color = event.target.value;
  draw();
});
$('opacity').addEventListener('input', (event) => {
  state.opacity = Number(event.target.value) / 100;
  $('opacity-value').textContent = `${event.target.value}%`;
  draw();
});
$('show-bounds').addEventListener('change', (event) => {
  state.bounds = event.target.checked;
  document.querySelectorAll('.regions').forEach((container) => container.classList.toggle('show-bounds', state.bounds));
});
$('search').addEventListener('input', renderResults);
$('results-list').addEventListener('click', (event) => {
  const row = event.target.closest('.result-row');
  if (!row) return;
  selectItem(Number(row.dataset.index), { center: true });
  document.body.classList.remove('mobile-sidebar-open');
});
$('results-list').addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const rows = [...$('results-list').querySelectorAll('.result-row')];
  const index = rows.indexOf(event.target);
  if (index === -1) return;
  event.preventDefault();
  const next = rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
  next.focus();
  selectItem(Number(next.dataset.index), { center: true });
});
for (const id of ['primary-regions', 'secondary-regions']) {
  $(id).addEventListener('click', (event) => {
    if (drag?.moved) return;
    const region = event.target.closest('.region');
    if (region) selectItem(Number(region.dataset.index), { fromCanvas: true });
  });
}

function zoom(factor, anchor) {
  state.fitting = false;
  setScale(state.scale * factor, anchor);
}
$('zoom-in').addEventListener('click', () => zoom(1.25));
$('zoom-out').addEventListener('click', () => zoom(0.8));
$('zoom-actual').addEventListener('click', () => {
  state.fitting = false;
  setScale(1);
});
$('zoom-fit').addEventListener('click', fit);
new ResizeObserver(() => { if (state.fitting) fit(); }).observe(viewport);
viewport.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom(Math.exp(-event.deltaY * 0.005), { x: event.clientX, y: event.clientY });
}, { passive: false });
viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.pointerType === 'touch') return;
  drag = {
    x: event.clientX, y: event.clientY,
    left: viewport.scrollLeft, top: viewport.scrollTop,
    pointerId: event.pointerId, moved: false,
  };
});
viewport.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
  viewport.scrollLeft = drag.left - dx;
  viewport.scrollTop = drag.top - dy;
});
function finishDrag() {
  if (!drag) return;
  if (viewport.hasPointerCapture(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId);
  viewport.classList.remove('dragging');
  setTimeout(() => { drag = null; }, 0);
}
viewport.addEventListener('pointerup', finishDrag);
viewport.addEventListener('pointercancel', finishDrag);
viewport.addEventListener('lostpointercapture', () => viewport.classList.remove('dragging'));

$('toggle-sidebar').addEventListener('click', () => {
  if (matchMedia('(max-width: 650px)').matches) {
    document.body.classList.toggle('mobile-sidebar-open');
  } else {
    document.body.classList.toggle('sidebar-hidden');
  }
});
document.addEventListener('pointerdown', (event) => {
  if (document.body.classList.contains('mobile-sidebar-open')
    && !event.target.closest('.sidebar') && !event.target.closest('#toggle-sidebar') && !dialog.open) {
    document.body.classList.remove('mobile-sidebar-open');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.body.classList.remove('mobile-sidebar-open');
  if (event.key === '/' && !dialog.open && !event.target.closest('input, textarea')) {
    event.preventDefault();
    if (matchMedia('(max-width: 650px)').matches) document.body.classList.add('mobile-sidebar-open');
    $('search').focus();
  }
});

async function copyAll() {
  if (!state.items.length) { notify('当前没有可复制的识别文字'); return; }
  const text = state.items.map((item) => item.words).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    notify('已复制全部识别文字');
  } catch {
    notify('浏览器未允许复制，请在识别数据中选择并复制文字');
  }
}
$('copy-all').addEventListener('click', copyAll);

$('export').addEventListener('click', () => {
  if (!state.image) { notify('请先导入原图与识别结果'); return; }
  const gap = state.mode === 'split' ? 32 : 0;
  const canvas = document.createElement('canvas');
  const width = state.image.naturalWidth;
  const height = state.image.naturalHeight;
  canvas.width = state.mode === 'split' ? width * 2 + gap : width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage($('primary-canvas'), 0, 0);
  if (state.mode === 'split') context.drawImage($('secondary-canvas'), width + gap, 0);
  if (state.bounds) {
    context.strokeStyle = state.color;
    context.globalAlpha = 0.65;
    context.lineWidth = 1;
    const panels = state.mode === 'split' ? [0, width + gap] : [0];
    for (const offset of panels) {
      for (const item of state.items) {
        const box = item.location;
        context.strokeRect(box.left + offset, box.top, box.width, box.height);
      }
    }
  }
  canvas.toBlob((blob) => {
    if (!blob) { notify('图片导出失败，请尝试缩小原图尺寸'); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.imageName.replace(/\.[^.]+$/, '')}-${state.mode}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出原始分辨率的对比图片');
  }, 'image/png');
});

void loadExample();
