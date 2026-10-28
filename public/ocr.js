export function parseOcr(input) {
  let data;
  try {
    data = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : input;
  } catch (error) {
    throw new Error(`JSON 格式错误：${error.message}`);
  }
  if (!data || !Array.isArray(data.words_result)) {
    throw new Error('JSON 中需要包含 words_result 数组。');
  }
  const fields = ['left', 'top', 'width', 'height'];
  const items = data.words_result.map((entry, index) => {
    const prefix = `第 ${index + 1} 项`;
    if (!entry || typeof entry.words !== 'string') {
      throw new Error(`${prefix}的 words 必须是字符串。`);
    }
    if (!entry.location || fields.some((field) => !Number.isFinite(entry.location[field]))) {
      throw new Error(`${prefix}的 location 需要包含数值 top、left、width、height。`);
    }
    const { left, top, width, height } = entry.location;
    if (left < 0 || top < 0 || width <= 0 || height <= 0) {
      throw new Error(`${prefix}的坐标不能为负数，宽度和高度必须大于 0。`);
    }
    return { words: entry.words, location: { left, top, width, height } };
  });
  return { data, items };
}

export function fitScale(width, height, availableWidth, availableHeight) {
  return Math.max(0.001, Math.min(availableWidth / width, availableHeight / height, 1));
}

export function isOutsideImage(item, width, height) {
  const box = item.location;
  return box.left + box.width > width || box.top + box.height > height;
}

export function textMetrics(context, item) {
  const { words, location } = item;
  const lines = words.replace(/\r\n?/g, '\n').split('\n');
  const lineHeight = location.height / Math.max(lines.length, 1);
  const fontSize = lineHeight / 1.16;
  context.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  const measuredWidth = Math.max(...lines.map((line) => context.measureText(line).width), 1);
  // Fit both axes: OCR boxes describe the rendered region, not a browser font size.
  return { lines, fontSize, lineHeight, horizontalScale: location.width / measuredWidth };
}

export function drawWords(context, items, { color = '#1677ff', opacity = 1 } = {}) {
  context.save();
  context.fillStyle = color;
  context.globalAlpha = opacity;
  context.textBaseline = 'middle';
  for (const item of items) {
    if (!item.words) continue;
    const { lines, fontSize, lineHeight, horizontalScale } = textMetrics(context, item);
    context.save();
    context.translate(item.location.left, item.location.top);
    context.scale(horizontalScale, 1);
    context.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    lines.forEach((line, index) => {
      context.fillText(line, 0, lineHeight * (index + 0.5));
    });
    context.restore();
  }
  context.restore();
}
