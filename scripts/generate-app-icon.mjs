import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const size = 1024;
const pixels = new Uint8Array(size * size * 4);

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const index = (y * size + x) * 4;
    const outer = roundedRectAlpha(x, y, 18, 18, size - 36, size - 36, 178);
    if (outer <= 0) {
      continue;
    }

    const base = gradientColor(x / size, y / size);
    const waveA = smoothstep(-0.1, 0.42, 0.34 + 0.16 * Math.sin((x + y * 0.32) / 120) - y / size + x / size * 0.12);
    const waveB = smoothstep(-0.2, 0.58, y / size - 0.5 + 0.18 * Math.sin((x - y) / 150));
    const color = mix(base, [255, 255, 255], 0.08 * waveA);
    const color2 = mix(color, [8, 33, 210], 0.22 * waveB);
    setPixel(index, color2[0], color2[1], color2[2], Math.round(255 * outer));

    const rim = roundedRectRing(x, y, 38, 38, size - 76, size - 76, 154, 12);
    if (rim > 0) {
      blendPixel(index, 255, 255, 255, Math.round(66 * rim));
    }
  }
}

drawChatShadow();
drawChatBubble();
drawKMark();
drawPlaneShadow();
drawPlane();

const png = encodePng(size, size, pixels);
writeFileSync(new URL("../src-tauri/icons/icon.png", import.meta.url), png);

function drawChatShadow() {
  for (let y = 180; y < 850; y += 1) {
    for (let x = 160; x < 875; x += 1) {
      const body = ellipseAlpha(x, y, 522, 482, 335, 252);
      const tail = triangleAlpha(x, y, [286, 676], [238, 850], [410, 727]);
      const alpha = Math.max(body, tail);
      if (alpha > 0) {
        const index = (y * size + x) * 4;
        blendPixel(index, 8, 23, 60, Math.round(54 * alpha));
      }
    }
  }
}

function drawChatBubble() {
  for (let y = 160; y < 820; y += 1) {
    for (let x = 140; x < 860; x += 1) {
      const body = ellipseAlpha(x, y, 512, 462, 330, 246);
      const tail = triangleAlpha(x, y, [276, 652], [230, 820], [400, 700]);
      const alpha = Math.max(body, tail);
      if (alpha > 0) {
        const shade = 1 - Math.max(0, (y - 280) / 720) * 0.06;
        const index = (y * size + x) * 4;
        blendPixel(index, 255 * shade, 255 * shade, 255 * shade, Math.round(252 * alpha));
      }
    }
  }
}

function drawKMark() {
  const strokes = [
    { from: [380, 330], to: [380, 670], width: 96, a: [255, 184, 0], b: [103, 42, 255] },
    { from: [462, 514], to: [600, 392], width: 92, a: [255, 57, 128], b: [251, 79, 116] },
    { from: [458, 528], to: [638, 686], width: 96, a: [71, 100, 255], b: [33, 222, 208] }
  ];

  for (const stroke of strokes) {
    drawCapsuleGradient(stroke.from, stroke.to, stroke.width, stroke.a, stroke.b);
  }
}

function drawPlaneShadow() {
  drawPolygon(
    [
      [545, 402],
      [888, 326],
      [680, 602],
      [628, 584]
    ],
    [0, 20, 90],
    42,
    20,
    28
  );
}

function drawPlane() {
  drawPolygon(
    [
      [538, 396],
      [888, 325],
      [688, 600],
      [632, 574]
    ],
    [250, 253, 255],
    245
  );
  drawPolygon(
    [
      [624, 456],
      [888, 325],
      [682, 530],
      [632, 574]
    ],
    [28, 91, 232],
    238
  );
  drawPolygon(
    [
      [682, 530],
      [888, 325],
      [732, 592],
      [692, 610]
    ],
    [255, 255, 255],
    248
  );
  drawPolygon(
    [
      [624, 456],
      [682, 530],
      [632, 574]
    ],
    [13, 207, 216],
    210
  );
}

function drawCapsuleGradient(from, to, width, colorA, colorB) {
  const minX = Math.floor(Math.min(from[0], to[0]) - width);
  const maxX = Math.ceil(Math.max(from[0], to[0]) + width);
  const minY = Math.floor(Math.min(from[1], to[1]) - width);
  const maxY = Math.ceil(Math.max(from[1], to[1]) + width);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSq = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = clamp(((x - from[0]) * dx + (y - from[1]) * dy) / lengthSq, 0, 1);
      const px = from[0] + dx * t;
      const py = from[1] + dy * t;
      const distance = Math.hypot(x - px, y - py);
      const alpha = smoothstep(width / 2 + 1, width / 2 - 1, distance);
      if (alpha > 0) {
        const color = mix(colorA, colorB, t);
        blendPixel((y * size + x) * 4, color[0], color[1], color[2], Math.round(248 * alpha));
      }
    }
  }
}

function drawPolygon(points, color, alpha, offsetX = 0, offsetY = 0) {
  const shifted = points.map(([x, y]) => [x + offsetX, y + offsetY]);
  const xs = shifted.map(([x]) => x);
  const ys = shifted.map(([, y]) => y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y += 1) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x += 1) {
      if (pointInPolygon(x, y, shifted)) {
        blendPixel((y * size + x) * 4, color[0], color[1], color[2], alpha);
      }
    }
  }
}

function gradientColor(x, y) {
  const stops = [
    { p: [0, 0], c: [255, 219, 28] },
    { p: [0.9, 0.02], c: [251, 60, 190] },
    { p: [0.92, 0.82], c: [53, 74, 255] },
    { p: [0.28, 0.9], c: [0, 204, 226] },
    { p: [0.05, 0.55], c: [117, 229, 50] }
  ];
  let total = 0;
  const color = [0, 0, 0];
  for (const stop of stops) {
    const distance = Math.hypot(x - stop.p[0], y - stop.p[1]);
    const weight = 1 / Math.max(0.04, distance ** 2.25);
    total += weight;
    color[0] += stop.c[0] * weight;
    color[1] += stop.c[1] * weight;
    color[2] += stop.c[2] * weight;
  }
  return color.map((value) => value / total);
}

function roundedRectAlpha(x, y, rx, ry, width, height, radius) {
  const qx = Math.abs(x - (rx + width / 2)) - width / 2 + radius;
  const qy = Math.abs(y - (ry + height / 2)) - height / 2 + radius;
  const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return smoothstep(1.5, -1.5, distance);
}

function roundedRectRing(x, y, rx, ry, width, height, radius, thickness) {
  const outer = roundedRectAlpha(x, y, rx, ry, width, height, radius);
  const inner = roundedRectAlpha(x, y, rx + thickness, ry + thickness, width - thickness * 2, height - thickness * 2, radius - thickness);
  return Math.max(0, outer - inner);
}

function ellipseAlpha(x, y, cx, cy, rx, ry) {
  const distance = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return smoothstep(1.012, 0.988, distance);
}

function triangleAlpha(x, y, a, b, c) {
  return pointInPolygon(x, y, [a, b, c]) ? 1 : 0;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function setPixel(index, r, g, b, a) {
  pixels[index] = clampByte(r);
  pixels[index + 1] = clampByte(g);
  pixels[index + 2] = clampByte(b);
  pixels[index + 3] = clampByte(a);
}

function blendPixel(index, r, g, b, a) {
  if (index < 0 || index >= pixels.length) return;
  const sourceA = clamp(a / 255, 0, 1);
  const destinationA = pixels[index + 3] / 255;
  const outputA = sourceA + destinationA * (1 - sourceA);
  if (outputA <= 0) return;
  pixels[index] = clampByte((r * sourceA + pixels[index] * destinationA * (1 - sourceA)) / outputA);
  pixels[index + 1] = clampByte((g * sourceA + pixels[index + 1] * destinationA * (1 - sourceA)) / outputA);
  pixels[index + 2] = clampByte((b * sourceA + pixels[index + 2] * destinationA * (1 - sourceA)) / outputA);
  pixels[index + 3] = clampByte(outputA * 255);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value) {
  return Math.round(clamp(value, 0, 255));
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = uint32(data.length);
  const crc = uint32(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
