import { DemoPortraitId, Landmarks68, Point2D } from './types';

export interface DemoPortraitResult {
  id: DemoPortraitId;
  name: string;
  subtitle: string;
  canvas: HTMLCanvasElement;
  landmarks: Landmarks68;
}

/**
 * Generates a realistic 512x512 studio portrait on an HTML5 Canvas
 * along with exact 68-point dlib-compatible facial landmarks.
 */
export function createDemoPortrait(id: DemoPortraitId): DemoPortraitResult {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const isElena = id === 'elena';

  // Canonical proportions centered cleanly inside 512x512
  const cx = 256;
  const cy = 248;
  const faceW = isElena ? 114 : 122;
  const faceH = isElena ? 150 : 156;

  // 1. Studio dark-slate vignette backdrop
  const bgGrad = ctx.createRadialGradient(cx, cy - 30, 40, cx, cy, 380);
  if (isElena) {
    bgGrad.addColorStop(0, '#2A3346');
    bgGrad.addColorStop(0.55, '#19202D');
    bgGrad.addColorStop(1, '#0D1118');
  } else {
    bgGrad.addColorStop(0, '#26303D');
    bgGrad.addColorStop(0.55, '#161C26');
    bgGrad.addColorStop(1, '#0C0F15');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Subtle rim glow behind head
  const rimGrad = ctx.createRadialGradient(cx, cy - 10, 80, cx, cy, 240);
  rimGrad.addColorStop(0, isElena ? 'rgba(96, 165, 250, 0.14)' : 'rgba(56, 189, 248, 0.12)');
  rimGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = rimGrad;
  ctx.fillRect(0, 0, size, size);

  // Back hair layer for Elena
  if (isElena) {
    ctx.save();
    const hairBackGrad = ctx.createLinearGradient(cx - 160, 80, cx + 160, 440);
    hairBackGrad.addColorStop(0, '#2D1B14');
    hairBackGrad.addColorStop(0.5, '#4A2B1D');
    hairBackGrad.addColorStop(1, '#1E110C');
    ctx.fillStyle = hairBackGrad;
    ctx.beginPath();
    ctx.moveTo(cx - 140, 210);
    ctx.bezierCurveTo(cx - 165, 310, cx - 150, 430, cx - 110, 512);
    ctx.lineTo(cx + 110, 512);
    ctx.bezierCurveTo(cx + 150, 430, cx + 165, 310, cx + 140, 210);
    ctx.bezierCurveTo(cx + 135, 95, cx - 135, 95, cx - 140, 210);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 2. Neck & Shoulders / Clothing
  const skinBase = isElena ? '#ECC1A6' : '#E2B496';
  const skinShadow = isElena ? '#C99374' : '#BC8769';
  const skinHighlight = isElena ? '#F8D8C3' : '#F2C9AE';

  // Shoulders
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(56, 512);
  ctx.quadraticCurveTo(100, 422, 188, 405);
  ctx.lineTo(324, 405);
  ctx.quadraticCurveTo(412, 422, 456, 512);
  ctx.closePath();
  const shirtGrad = ctx.createLinearGradient(cx, 400, cx, 512);
  if (isElena) {
    shirtGrad.addColorStop(0, '#2B364A');
    shirtGrad.addColorStop(1, '#151B26');
  } else {
    shirtGrad.addColorStop(0, '#242C3A');
    shirtGrad.addColorStop(1, '#12161E');
  }
  ctx.fillStyle = shirtGrad;
  ctx.fill();

  // Collar subtle detail
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(192, 408);
  ctx.quadraticCurveTo(cx, 455, 320, 408);
  ctx.stroke();
  ctx.restore();

  // Neck
  ctx.save();
  const neckW = isElena ? 46 : 56;
  const neckGrad = ctx.createLinearGradient(cx - neckW, 340, cx + neckW, 435);
  neckGrad.addColorStop(0, skinShadow);
  neckGrad.addColorStop(0.5, skinBase);
  neckGrad.addColorStop(1, skinShadow);
  ctx.fillStyle = neckGrad;
  ctx.beginPath();
  ctx.moveTo(cx - neckW, 335);
  ctx.lineTo(cx - neckW - 8, 420);
  ctx.quadraticCurveTo(cx, 450, cx + neckW + 8, 420);
  ctx.lineTo(cx + neckW, 335);
  ctx.closePath();
  ctx.fill();

  // Chin cast shadow on neck
  const neckShadow = ctx.createRadialGradient(cx, 358, 12, cx, 368, 72);
  neckShadow.addColorStop(0, 'rgba(65, 28, 16, 0.42)');
  neckShadow.addColorStop(1, 'rgba(65, 28, 16, 0)');
  ctx.fillStyle = neckShadow;
  ctx.fillRect(cx - 80, 335, 160, 80);
  ctx.restore();

  // Ears
  const drawEar = (side: -1 | 1) => {
    const ex = cx + side * (faceW - 2);
    const ey = cy + 6;
    ctx.save();
    ctx.fillStyle = skinShadow;
    ctx.beginPath();
    ctx.ellipse(ex, ey, 14, 28, side * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(110, 58, 38, 0.25)';
    ctx.beginPath();
    ctx.ellipse(ex - side * 2, ey + 2, 7, 17, side * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawEar(-1);
  drawEar(1);

  // Build exact 68 landmarks BEFORE drawing face geometry so face features align 1:1 with mesh!
  const landmarks = buildCanonicalLandmarks(cx, cy, faceW, faceH, isElena);

  // 3. Face silhouette (from jaw 0..16 + forehead dome)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(landmarks[0].x, landmarks[0].y);
  for (let i = 1; i <= 16; i++) {
    const prev = landmarks[i - 1];
    const curr = landmarks[i];
    const mx = (prev.x + curr.x) / 2;
    const my = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
  }
  ctx.lineTo(landmarks[16].x, landmarks[16].y);
  // Forehead dome
  ctx.bezierCurveTo(
    cx + faceW + 4,
    cy - faceH * 0.85,
    cx - faceW - 4,
    cy - faceH * 0.85,
    landmarks[0].x,
    landmarks[0].y
  );
  ctx.closePath();

  const faceGrad = ctx.createRadialGradient(cx - 12, cy - 28, 18, cx, cy, faceH * 1.15);
  faceGrad.addColorStop(0, skinHighlight);
  faceGrad.addColorStop(0.55, skinBase);
  faceGrad.addColorStop(1, skinShadow);
  ctx.fillStyle = faceGrad;
  ctx.fill();

  // Cheek warmth & facial contour shading
  ctx.clip();

  // Forehead & temple shading
  const cheekBlush = (x: number, y: number) => {
    const g = ctx.createRadialGradient(x, y, 4, x, y, 44);
    g.addColorStop(0, isElena ? 'rgba(218, 112, 102, 0.22)' : 'rgba(198, 104, 88, 0.14)');
    g.addColorStop(1, 'rgba(218, 112, 102, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 50, y - 50, 100, 100);
  };
  cheekBlush(cx - 56, cy + 20);
  cheekBlush(cx + 56, cy + 20);

  // Eye socket subtle depth
  const eyeSocket = (x: number, y: number) => {
    const g = ctx.createRadialGradient(x, y, 5, x, y, 34);
    g.addColorStop(0, 'rgba(120, 68, 48, 0.2)');
    g.addColorStop(1, 'rgba(120, 68, 48, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 40, y - 40, 80, 80);
  };
  eyeSocket(cx - 44, cy - 18);
  eyeSocket(cx + 44, cy - 18);

  // Subtle stubble / jawline contour for Artem
  if (!isElena) {
    const beardGrad = ctx.createLinearGradient(cx, cy + 40, cx, cy + faceH + 10);
    beardGrad.addColorStop(0, 'rgba(42, 34, 30, 0)');
    beardGrad.addColorStop(0.45, 'rgba(42, 34, 30, 0.14)');
    beardGrad.addColorStop(1, 'rgba(32, 26, 22, 0.28)');
    ctx.fillStyle = beardGrad;
    ctx.fillRect(cx - faceW, cy + 38, faceW * 2, faceH);
  }
  ctx.restore();

  // 4. Nose shading along landmarks 27..35
  ctx.save();
  const noseTop = landmarks[27];
  const noseTip = landmarks[30];
  const noseLeft = landmarks[31];
  const noseRight = landmarks[35];

  // Nose bridge highlight
  const bridgeGrad = ctx.createLinearGradient(noseTop.x - 10, noseTop.y, noseTop.x + 12, noseTip.y);
  bridgeGrad.addColorStop(0, 'rgba(255, 240, 228, 0.35)');
  bridgeGrad.addColorStop(1, 'rgba(255, 240, 228, 0.12)');
  ctx.strokeStyle = bridgeGrad;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(noseTop.x, noseTop.y);
  ctx.lineTo(noseTip.x, noseTip.y - 2);
  ctx.stroke();

  // Nose side & under-tip shadow
  ctx.fillStyle = 'rgba(128, 72, 50, 0.22)';
  ctx.beginPath();
  ctx.moveTo(noseLeft.x - 2, noseLeft.y);
  ctx.quadraticCurveTo(noseTip.x, noseTip.y + 10, noseRight.x + 2, noseRight.y);
  ctx.quadraticCurveTo(noseTip.x, noseTip.y + 2, noseLeft.x - 2, noseLeft.y);
  ctx.fill();

  // Nostrils
  ctx.fillStyle = 'rgba(82, 38, 24, 0.55)';
  ctx.beginPath();
  ctx.ellipse(landmarks[32].x, landmarks[32].y - 1, 4.5, 2.5, -0.25, 0, Math.PI * 2);
  ctx.ellipse(landmarks[34].x, landmarks[34].y - 1, 4.5, 2.5, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 5. Eyes (36..41 left, 42..47 right)
  const drawEye = (pts: Point2D[], irisColor: string) => {
    const outer = pts[0];
    const upper1 = pts[1];
    const upper2 = pts[2];
    const inner = pts[3];
    const lower2 = pts[4];
    const lower1 = pts[5];
    const eyeCx = (outer.x + inner.x) / 2;
    const eyeCy = (upper1.y + upper2.y + lower1.y + lower2.y) / 4;

    ctx.save();
    // Sclera clip path
    ctx.beginPath();
    ctx.moveTo(outer.x, outer.y);
    ctx.bezierCurveTo(upper1.x - 4, upper1.y - 2, upper2.x + 4, upper2.y - 2, inner.x, inner.y);
    ctx.bezierCurveTo(lower2.x + 4, lower2.y + 2, lower1.x - 4, lower1.y + 2, outer.x, outer.y);
    ctx.closePath();

    // Sclera gradient
    const scleraGrad = ctx.createRadialGradient(eyeCx, eyeCy, 2, eyeCx, eyeCy, 22);
    scleraGrad.addColorStop(0, '#F7F8FA');
    scleraGrad.addColorStop(0.75, '#E4E7EC');
    scleraGrad.addColorStop(1, '#C7CED8');
    ctx.fillStyle = scleraGrad;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // Iris
    const irisR = 9.8;
    const irisGrad = ctx.createRadialGradient(eyeCx, eyeCy, 2, eyeCx, eyeCy, irisR);
    irisGrad.addColorStop(0, '#1A2433');
    irisGrad.addColorStop(0.35, irisColor);
    irisGrad.addColorStop(0.88, '#1E293B');
    irisGrad.addColorStop(1, '#0F172A');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.arc(eyeCx, eyeCy + 0.5, irisR, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.fillStyle = '#090D14';
    ctx.beginPath();
    ctx.arc(eyeCx, eyeCy + 0.5, 4.3, 0, Math.PI * 2);
    ctx.fill();

    // Catchlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(eyeCx - 3.2, eyeCy - 2.8, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(eyeCx + 2.8, eyeCy + 2.5, 1.0, 0, Math.PI * 2);
    ctx.fill();

    // Upper eyelid shadow on sclera
    ctx.fillStyle = 'rgba(20, 18, 24, 0.22)';
    ctx.fillRect(eyeCx - 24, eyeCy - 14, 48, 8);
    ctx.restore();

    // Eyelash upper line
    ctx.strokeStyle = isElena ? '#1D1412' : '#231C19';
    ctx.lineWidth = isElena ? 2.8 : 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(outer.x - 1, outer.y);
    ctx.bezierCurveTo(upper1.x - 4, upper1.y - 2, upper2.x + 4, upper2.y - 2, inner.x + 1, inner.y);
    ctx.stroke();

    // Upper eyelid crease
    ctx.strokeStyle = 'rgba(110, 62, 44, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(outer.x + 2, outer.y - 6);
    ctx.quadraticCurveTo(eyeCx, upper1.y - 7, inner.x - 2, inner.y - 5);
    ctx.stroke();

    ctx.restore();
  };

  const irisColor = isElena ? '#4C7A96' : '#5E6E52';
  drawEye(landmarks.slice(36, 42), irisColor);
  drawEye(landmarks.slice(42, 48), irisColor);

  // 6. Eyebrows (17..21 left, 22..26 right)
  const drawBrow = (pts: Point2D[]) => {
    ctx.save();
    ctx.strokeStyle = isElena ? '#3A2319' : '#261E19';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = isElena ? 6.5 : 8.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    // Individual brow hair texture strokes
    ctx.strokeStyle = isElena ? 'rgba(35, 18, 12, 0.55)' : 'rgba(20, 14, 10, 0.55)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      for (let t = 0; t < 1; t += 0.25) {
        const bx = p0.x + (p1.x - p0.x) * t;
        const by = p0.y + (p1.y - p0.y) * t;
        ctx.beginPath();
        ctx.moveTo(bx - 1, by + 3);
        ctx.lineTo(bx + 2, by - 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  drawBrow(landmarks.slice(17, 22));
  drawBrow(landmarks.slice(22, 27));

  // 7. Lips (48..59 outer, 60..67 inner)
  ctx.save();
  const lipOuter = landmarks.slice(48, 60);
  const lipUpperGrad = ctx.createLinearGradient(cx, lipOuter[2].y, cx, lipOuter[9].y);
  if (isElena) {
    lipUpperGrad.addColorStop(0, '#B8555A');
    lipUpperGrad.addColorStop(0.5, '#C7686D');
    lipUpperGrad.addColorStop(1, '#A4444A');
  } else {
    lipUpperGrad.addColorStop(0, '#AA6B61');
    lipUpperGrad.addColorStop(0.5, '#BC7E74');
    lipUpperGrad.addColorStop(1, '#985A51');
  }

  // Fill closed lip silhouette
  ctx.beginPath();
  ctx.moveTo(lipOuter[0].x, lipOuter[0].y);
  for (let i = 1; i < lipOuter.length; i++) {
    ctx.lineTo(lipOuter[i].x, lipOuter[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = lipUpperGrad;
  ctx.fill();

  // Lower lip subtle highlight
  const lowerLipMid = lipOuter[9];
  const lipGloss = ctx.createRadialGradient(
    lowerLipMid.x,
    lowerLipMid.y - 3,
    2,
    lowerLipMid.x,
    lowerLipMid.y - 3,
    22
  );
  lipGloss.addColorStop(0, isElena ? 'rgba(255, 220, 220, 0.36)' : 'rgba(255, 225, 215, 0.2)');
  lipGloss.addColorStop(1, 'rgba(255, 220, 220, 0)');
  ctx.fillStyle = lipGloss;
  ctx.fill();

  // Lip parting line (60..64)
  ctx.strokeStyle = 'rgba(72, 24, 24, 0.78)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(landmarks[48].x, landmarks[48].y);
  ctx.lineTo(landmarks[60].x, landmarks[60].y);
  ctx.lineTo(landmarks[61].x, landmarks[61].y);
  ctx.lineTo(landmarks[62].x, landmarks[62].y);
  ctx.lineTo(landmarks[63].x, landmarks[63].y);
  ctx.lineTo(landmarks[64].x, landmarks[64].y);
  ctx.lineTo(landmarks[54].x, landmarks[54].y);
  ctx.stroke();

  // Subtle under-lip chin dimple shadow
  const chinShadow = ctx.createRadialGradient(cx, lipOuter[9].y + 10, 2, cx, lipOuter[9].y + 12, 24);
  chinShadow.addColorStop(0, 'rgba(110, 62, 44, 0.25)');
  chinShadow.addColorStop(1, 'rgba(110, 62, 44, 0)');
  ctx.fillStyle = chinShadow;
  ctx.fillRect(cx - 32, lipOuter[9].y, 64, 28);
  ctx.restore();

  // 8. Front Hair Layer
  ctx.save();
  if (isElena) {
    const hairGrad = ctx.createLinearGradient(cx - 120, 50, cx + 120, 260);
    hairGrad.addColorStop(0, '#3D2216');
    hairGrad.addColorStop(0.5, '#5A3422');
    hairGrad.addColorStop(1, '#26140D');
    ctx.fillStyle = hairGrad;

    // Left sweep
    ctx.beginPath();
    ctx.moveTo(cx - 10, 80);
    ctx.bezierCurveTo(cx - 95, 72, cx - 148, 130, cx - 134, 245);
    ctx.bezierCurveTo(cx - 122, 185, cx - 95, 136, cx - 10, 128);
    ctx.closePath();
    ctx.fill();

    // Right sweep
    ctx.beginPath();
    ctx.moveTo(cx - 15, 80);
    ctx.bezierCurveTo(cx + 95, 68, cx + 148, 128, cx + 134, 245);
    ctx.bezierCurveTo(cx + 120, 180, cx + 92, 136, cx - 15, 128);
    ctx.closePath();
    ctx.fill();
  } else {
    const hairGrad = ctx.createLinearGradient(cx - 110, 65, cx + 110, 190);
    hairGrad.addColorStop(0, '#1E1A18');
    hairGrad.addColorStop(0.5, '#342C27');
    hairGrad.addColorStop(1, '#191513');
    ctx.fillStyle = hairGrad;

    ctx.beginPath();
    ctx.moveTo(cx - faceW + 2, cy - 34);
    ctx.bezierCurveTo(cx - faceW - 14, cy - 130, cx - 60, cy - 190, cx + 8, cy - 188);
    ctx.bezierCurveTo(cx + 85, cy - 186, cx + faceW + 14, cy - 130, cx + faceW - 2, cy - 34);
    ctx.bezierCurveTo(cx + faceW - 12, cy - 94, cx + 60, cy - 116, cx + 12, cy - 122);
    ctx.bezierCurveTo(cx - 48, cy - 116, cx - faceW + 10, cy - 96, cx - faceW + 2, cy - 34);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  return {
    id,
    name: isElena ? 'Елена' : 'Артём',
    subtitle: isElena ? 'Студийный портрет · Женский' : 'Студийный портрет · Мужской',
    canvas,
    landmarks,
  };
}

/**
 * Generates exact 68-point facial landmarks matching dlib/face-api topology.
 */
export function buildCanonicalLandmarks(
  cx: number,
  cy: number,
  faceW: number,
  faceH: number,
  isElena: boolean
): Landmarks68 {
  const pts: Point2D[] = [];

  // 0..16: Jawline (17 points)
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI; // 0 (left) -> pi (right)
    const angle = Math.PI - t; // pi -> 0
    const rx = faceW * (isElena ? 0.96 : 1.0);
    const ry = faceH * (i >= 6 && i <= 10 ? 0.96 : 0.94);
    const chinPinch = isElena ? 0.88 : 0.93;
    const xFactor = Math.cos(angle);
    const yFactor = Math.sin(angle);
    const x = cx + xFactor * rx * (1 - 0.12 * yFactor * (1 - chinPinch));
    const y = cy + 6 + yFactor * ry;
    pts.push({ x, y });
  }

  // 17..21: Left eyebrow
  const browY = cy - 48;
  pts.push(
    { x: cx - 72, y: browY + 8 },
    { x: cx - 58, y: browY - 1 },
    { x: cx - 42, y: browY - 4 },
    { x: cx - 26, y: browY - 1 },
    { x: cx - 14, y: browY + 3 }
  );

  // 22..26: Right eyebrow
  pts.push(
    { x: cx + 14, y: browY + 3 },
    { x: cx + 26, y: browY - 1 },
    { x: cx + 42, y: browY - 4 },
    { x: cx + 58, y: browY - 1 },
    { x: cx + 72, y: browY + 8 }
  );

  // 27..30: Nose bridge
  pts.push(
    { x: cx, y: cy - 26 },
    { x: cx, y: cy - 8 },
    { x: cx, y: cy + 10 },
    { x: cx, y: cy + 25 }
  );

  // 31..35: Nose base
  pts.push(
    { x: cx - 19, y: cy + 32 },
    { x: cx - 9, y: cy + 35 },
    { x: cx, y: cy + 37 },
    { x: cx + 9, y: cy + 35 },
    { x: cx + 19, y: cy + 32 }
  );

  // 36..41: Left eye
  const eyeY = cy - 18;
  const leCx = cx - 43;
  pts.push(
    { x: leCx - 19, y: eyeY + 1 },
    { x: leCx - 8, y: eyeY - 7.5 },
    { x: leCx + 8, y: eyeY - 7.5 },
    { x: leCx + 19, y: eyeY + 2 },
    { x: leCx + 7, y: eyeY + 7.5 },
    { x: leCx - 7, y: eyeY + 7.5 }
  );

  // 42..47: Right eye
  const reCx = cx + 43;
  pts.push(
    { x: reCx - 19, y: eyeY + 2 },
    { x: reCx - 8, y: eyeY - 7.5 },
    { x: reCx + 8, y: eyeY - 7.5 },
    { x: reCx + 19, y: eyeY + 1 },
    { x: reCx + 7, y: eyeY + 7.5 },
    { x: reCx - 7, y: eyeY + 7.5 }
  );

  // 48..59: Outer lips
  const mouthY = cy + 68;
  const mouthHalfW = isElena ? 32 : 34;
  pts.push(
    { x: cx - mouthHalfW, y: mouthY },       // 48 left corner
    { x: cx - 19, y: mouthY - 7 },           // 49
    { x: cx - 7, y: mouthY - 10 },           // 50
    { x: cx, y: mouthY - 8 },                // 51 cupid bow
    { x: cx + 7, y: mouthY - 10 },           // 52
    { x: cx + 19, y: mouthY - 7 },           // 53
    { x: cx + mouthHalfW, y: mouthY },       // 54 right corner
    { x: cx + 20, y: mouthY + 9 },           // 55
    { x: cx + 8, y: mouthY + 13 },           // 56
    { x: cx, y: mouthY + 14 },               // 57 bottom center
    { x: cx - 8, y: mouthY + 13 },           // 58
    { x: cx - 20, y: mouthY + 9 }            // 59
  );

  // 60..67: Inner lips
  pts.push(
    { x: cx - mouthHalfW + 6, y: mouthY },   // 60
    { x: cx - 10, y: mouthY - 2 },           // 61
    { x: cx, y: mouthY - 1.5 },              // 62
    { x: cx + 10, y: mouthY - 2 },           // 63
    { x: cx + mouthHalfW - 6, y: mouthY },   // 64
    { x: cx + 10, y: mouthY + 2.5 },         // 65
    { x: cx, y: mouthY + 3 },                // 66
    { x: cx - 10, y: mouthY + 2.5 }          // 67
  );

  return pts;
}
