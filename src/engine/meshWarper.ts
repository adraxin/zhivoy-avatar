import { AvatarSettings, Landmarks68, Point2D } from './types';

export interface Triangle {
  i0: number;
  i1: number;
  i2: number;
}

export interface MeshState {
  sourceCanvas: HTMLCanvasElement;
  basePoints: Point2D[]; // 68 landmarks + 16 perimeter/head/neck anchor points
  triangles: Triangle[];
  eyelidSkinColor: string;
}

const CANVAS_SIZE = 512;

/**
 * Adds 16 perimeter & structural anchor points around the 68 landmarks
 * so the triangular mesh covers the entire 512x512 viewport smoothly.
 */
export function buildMeshPoints(landmarks68: Landmarks68): Point2D[] {
  const pts = landmarks68.map((p) => ({ x: p.x, y: p.y }));

  // Estimate head top & forehead anchors from eyebrow & jaw span
  const leftJaw = pts[0];
  const rightJaw = pts[16];
  const browMidY = (pts[19].y + pts[24].y) / 2;
  const faceCenterX = (leftJaw.x + rightJaw.x) / 2;
  const faceW = Math.max(80, rightJaw.x - leftJaw.x);

  // 4 forehead / crown points (indices 68..71)
  pts.push(
    { x: clamp(faceCenterX - faceW * 0.45, 16, CANVAS_SIZE - 16), y: clamp(browMidY - faceW * 0.35, 12, CANVAS_SIZE - 16) },
    { x: clamp(faceCenterX, 16, CANVAS_SIZE - 16), y: clamp(browMidY - faceW * 0.48, 12, CANVAS_SIZE - 16) },
    { x: clamp(faceCenterX + faceW * 0.45, 16, CANVAS_SIZE - 16), y: clamp(browMidY - faceW * 0.35, 12, CANVAS_SIZE - 16) },
    // Neck / collar anchor (index 71)
    { x: clamp(faceCenterX, 16, CANVAS_SIZE - 16), y: clamp(pts[8].y + 70, 20, CANVAS_SIZE - 12) }
  );

  // 12 outer frame boundary anchors (indices 72..83) pinned cleanly
  const S = CANVAS_SIZE;
  const M = S / 2;
  pts.push(
    { x: 0, y: 0 },
    { x: M, y: 0 },
    { x: S, y: 0 },
    { x: S, y: M * 0.65 },
    { x: S, y: M * 1.35 },
    { x: S, y: S },
    { x: M * 1.4, y: S },
    { x: M, y: S },
    { x: M * 0.6, y: S },
    { x: 0, y: S },
    { x: 0, y: M * 1.35 },
    { x: 0, y: M * 0.65 }
  );

  return pts;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Bowyer-Watson 2D Delaunay triangulation.
 */
export function triangulateDelaunay(points: Point2D[]): Triangle[] {
  const n = points.length;
  if (n < 3) return [];

  // Super-triangle large enough to enclose all points
  const superPts: Point2D[] = [
    { x: -2000, y: -2000 },
    { x: 4000, y: -2000 },
    { x: 512, y: 4000 },
  ];
  const allPts = points.concat(superPts);
  const s0 = n;
  const s1 = n + 1;
  const s2 = n + 2;

  interface CircumTri {
    i0: number;
    i1: number;
    i2: number;
    cx: number;
    cy: number;
    r2: number;
  }

  const makeTri = (i0: number, i1: number, i2: number): CircumTri => {
    const p0 = allPts[i0];
    const p1 = allPts[i1];
    const p2 = allPts[i2];
    const ax = p0.x, ay = p0.y;
    const bx = p1.x, by = p1.y;
    const cx = p2.x, cy = p2.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-8) {
      return { i0, i1, i2, cx: 0, cy: 0, r2: -1 };
    }
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    const dx = ux - ax;
    const dy = uy - ay;
    return { i0, i1, i2, cx: ux, cy: uy, r2: dx * dx + dy * dy };
  };

  let triangles: CircumTri[] = [makeTri(s0, s1, s2)];

  for (let pIdx = 0; pIdx < n; pIdx++) {
    const p = allPts[pIdx];
    const bad: CircumTri[] = [];
    const good: CircumTri[] = [];

    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      const dx = p.x - tri.cx;
      const dy = p.y - tri.cy;
      if (dx * dx + dy * dy <= tri.r2 + 1e-6) {
        bad.push(tri);
      } else {
        good.push(tri);
      }
    }

    // Collect boundary edges of polygonal hole
    const edges: [number, number][] = [];
    const addOrRemoveEdge = (a: number, b: number) => {
      for (let i = 0; i < edges.length; i++) {
        const [ea, eb] = edges[i];
        if ((ea === a && eb === b) || (ea === b && eb === a)) {
          edges.splice(i, 1);
          return;
        }
      }
      edges.push([a, b]);
    };

    for (let t = 0; t < bad.length; t++) {
      const b = bad[t];
      addOrRemoveEdge(b.i0, b.i1);
      addOrRemoveEdge(b.i1, b.i2);
      addOrRemoveEdge(b.i2, b.i0);
    }

    triangles = good;
    for (let e = 0; e < edges.length; e++) {
      const [ea, eb] = edges[e];
      triangles.push(makeTri(ea, eb, pIdx));
    }
  }

  return triangles
    .filter((t) => t.i0 < n && t.i1 < n && t.i2 < n && t.r2 > 0)
    .map((t) => ({ i0: t.i0, i1: t.i1, i2: t.i2 }));
}

/**
 * Samples average skin tone right above the upper eyelid for natural blinking.
 */
export function sampleEyelidSkinColor(canvas: HTMLCanvasElement, landmarks: Landmarks68): string {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#D9A78B';
    const samplePts = [
      { x: Math.round((landmarks[37].x + landmarks[19].x) / 2), y: Math.round((landmarks[37].y + landmarks[19].y) / 2 + 3) },
      { x: Math.round((landmarks[44].x + landmarks[24].x) / 2), y: Math.round((landmarks[44].y + landmarks[24].y) / 2 + 3) },
    ];
    let r = 0, g = 0, b = 0, count = 0;
    for (const sp of samplePts) {
      const sx = clamp(sp.x, 2, canvas.width - 3);
      const sy = clamp(sp.y, 2, canvas.height - 3);
      const data = ctx.getImageData(sx - 1, sy - 1, 3, 3).data;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }
    if (count === 0) return '#D9A78B';
    // Slightly darken eyelid crease tone for realism
    const rr = Math.round((r / count) * 0.92);
    const gg = Math.round((g / count) * 0.90);
    const bb = Math.round((b / count) * 0.88);
    return `rgb(${rr}, ${gg}, ${bb})`;
  } catch {
    return '#D9A78B';
  }
}

export function createMeshState(sourceCanvas: HTMLCanvasElement, landmarks68: Landmarks68): MeshState {
  const basePoints = buildMeshPoints(landmarks68);
  const triangles = triangulateDelaunay(basePoints);
  const eyelidSkinColor = sampleEyelidSkinColor(sourceCanvas, landmarks68);
  return {
    sourceCanvas,
    basePoints,
    triangles,
    eyelidSkinColor,
  };
}

export interface AnimationFrameParams {
  timeSec: number;
  blinkAmount: number; // 0 (open) .. 1 (closed)
  mouthOpen: number;   // 0 (closed) .. 1 (wide open)
  lookX: number;       // -1 .. 1
  lookY: number;       // -1 .. 1
  settings: AvatarSettings;
}

/**
 * Computes deformed 84 mesh vertices for the current animation frame.
 */
export function computeDeformedPoints(
  basePoints: Point2D[],
  params: AnimationFrameParams
): Point2D[] {
  const { timeSec, blinkAmount, mouthOpen, lookX, lookY, settings } = params;
  const deformed = basePoints.map((p) => ({ x: p.x, y: p.y }));

  // Face center & scale reference
  const noseTip = basePoints[30];
  const leftFace = basePoints[0];
  const rightFace = basePoints[16];
  const faceW = Math.max(80, rightFace.x - leftFace.x);
  const scale = faceW / 220;

  // Idle organic breathing & subtle head sway
  const idleMul = settings.idleMotion;
  const swayX = (Math.sin(timeSec * 0.85) * 2.8 + Math.sin(timeSec * 0.37) * 1.4) * idleMul * scale;
  const swayY = (Math.sin(timeSec * 1.45) * 2.2 + Math.cos(timeSec * 0.55) * 1.1) * idleMul * scale;
  const swayRoll = Math.sin(timeSec * 0.62) * 0.018 * idleMul;

  // Cursor gaze / head tracking offsets
  const trackMul = settings.headTracking;
  const headShiftX = lookX * 14 * trackMul * scale + swayX;
  const headShiftY = lookY * 10 * trackMul * scale + swayY;
  const yawAngle = lookX * 0.14 * trackMul;

  // 1. Apply 2.5D head movement to landmarks 0..71 (leave outer frame 72..83 pinned)
  for (let i = 0; i <= 71; i++) {
    const p = basePoints[i];
    const rx = p.x - noseTip.x;
    const ry = p.y - noseTip.y;

    // Weight: inner facial features move fully; jaw outer edges move 80%; neck anchor (71) moves 25%
    let w = 1.0;
    if (i === 71) {
      w = 0.25;
    } else if (i >= 68 && i <= 70) {
      w = 0.78;
    } else if (i <= 2 || i >= 14) {
      w = 0.78;
    } else if (i <= 5 || i >= 11) {
      w = 0.88;
    }

    // Subtle 2.5D yaw compression + roll rotation
    const cosR = Math.cos(swayRoll * w);
    const sinR = Math.sin(swayRoll * w);
    const rotX = rx * cosR - ry * sinR;
    const rotY = rx * sinR + ry * cosR;

    // Parallax depth shift: nose & center features protrude slightly forward during yaw
    const distFromCenter = Math.min(1, Math.hypot(rx, ry) / (faceW * 0.65));
    const depthBoost = 1.0 - distFromCenter * 0.38;
    const parallaxX = headShiftX * w * (0.85 + 0.25 * depthBoost);
    const parallaxY = headShiftY * w * (0.85 + 0.2 * depthBoost);

    // Horizontal foreshortening on turning side
    const yawCompress = 1 - Math.abs(yawAngle) * 0.12 - (rx / faceW) * yawAngle * 0.22;

    deformed[i].x = noseTip.x + rotX * yawCompress + parallaxX;
    deformed[i].y = noseTip.y + rotY + parallaxY;
  }

  // 2. Blinking: move upper eyelid vertices (37, 38 & 43, 44) smoothly down toward lower lid
  if (blinkAmount > 0.005) {
    const closeEye = (u1: number, u2: number, l1: number, l2: number, browIndices: number[]) => {
      const target1Y = deformed[l2].y;
      const target2Y = deformed[l1].y;
      deformed[u1].y = deformed[u1].y + (target1Y - deformed[u1].y) * blinkAmount * 0.92;
      deformed[u2].y = deformed[u2].y + (target2Y - deformed[u2].y) * blinkAmount * 0.92;
      // Micro brow dip on blink
      for (const bi of browIndices) {
        deformed[bi].y += blinkAmount * 1.4 * scale;
      }
    };
    closeEye(37, 38, 40, 41, [18, 19, 20]);
    closeEye(43, 44, 46, 47, [23, 24, 25]);
  }

  // 3. Lip-sync: lower lip, chin & subtle upper lip lift + corner articulation
  const mAmp = mouthOpen * settings.mouthAmplitude;
  if (mAmp > 0.005) {
    const jawDrop = mAmp * 23 * scale;

    // Slight upper lip lift for natural vowel articulation
    const upperLift = mAmp * 2.2 * scale;
    for (const ui of [49, 50, 51, 52, 53, 61, 62, 63]) {
      deformed[ui].y -= upperLift;
    }

    // Mouth corners slightly narrow on open vowels
    const cornerPinch = mAmp * 2.4 * scale;
    deformed[48].x += cornerPinch;
    deformed[60].x += cornerPinch;
    deformed[54].x -= cornerPinch;
    deformed[64].x -= cornerPinch;
    deformed[48].y += jawDrop * 0.14;
    deformed[54].y += jawDrop * 0.14;

    // Lower inner lip (65..67) & lower outer lip (55..59)
    const innerWeights: Record<number, number> = { 65: 0.85, 66: 1.0, 67: 0.85 };
    for (const [idxStr, w] of Object.entries(innerWeights)) {
      deformed[Number(idxStr)].y += jawDrop * w;
    }

    const outerWeights: Record<number, number> = {
      55: 0.58,
      56: 0.88,
      57: 0.98,
      58: 0.88,
      59: 0.58,
    };
    for (const [idxStr, w] of Object.entries(outerWeights)) {
      deformed[Number(idxStr)].y += jawDrop * w;
    }

    // Chin & lower jawline follow smoothly
    const chinWeights: Record<number, number> = {
      5: 0.16,
      6: 0.36,
      7: 0.55,
      8: 0.64,
      9: 0.55,
      10: 0.36,
      11: 0.16,
    };
    for (const [idxStr, w] of Object.entries(chinWeights)) {
      deformed[Number(idxStr)].y += jawDrop * w;
    }
  }

  return deformed;
}

/**
 * Renders the warped facial mesh onto the target 2D canvas.
 */
export function renderWarpedAvatar(
  ctx: CanvasRenderingContext2D,
  mesh: MeshState,
  deformed: Point2D[],
  params: AnimationFrameParams,
  options?: {
    showMesh?: boolean;
    showLandmarks?: boolean;
    hoveredPointIndex?: number | null;
    activePointIndex?: number | null;
  }
): void {
  const { sourceCanvas, basePoints, triangles, eyelidSkinColor } = mesh;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const scaleCanvas = W / CANVAS_SIZE;

  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Draw base image as safety backdrop in case of extreme edge distortion
  ctx.drawImage(sourceCanvas, 0, 0, W, H);

  // Draw each Delaunay triangle with affine UV mapping + tiny 0.65px bleed to eliminate subpixel seams
  for (let t = 0; t < triangles.length; t++) {
    const tri = triangles[t];
    const s0 = basePoints[tri.i0];
    const s1 = basePoints[tri.i1];
    const s2 = basePoints[tri.i2];

    const d0 = deformed[tri.i0];
    const d1 = deformed[tri.i1];
    const d2 = deformed[tri.i2];

    drawTexturedTriangle(
      ctx,
      sourceCanvas,
      s0.x, s0.y,
      s1.x, s1.y,
      s2.x, s2.y,
      d0.x * scaleCanvas, d0.y * scaleCanvas,
      d1.x * scaleCanvas, d1.y * scaleCanvas,
      d2.x * scaleCanvas, d2.y * scaleCanvas
    );
  }

  // Oral cavity shading during speech
  const mAmp = params.mouthOpen * params.settings.mouthAmplitude;
  if (mAmp > 0.05) {
    drawMouthCavity(ctx, deformed, mAmp, scaleCanvas);
  }

  // Realistic upper eyelid closure overlay during blink
  if (params.blinkAmount > 0.12) {
    drawEyelidClosure(ctx, deformed, params.blinkAmount, eyelidSkinColor, scaleCanvas);
  }

  // Optional debug wireframe & draggable landmarks for manual calibration
  if (options?.showMesh || options?.showLandmarks) {
    ctx.save();
    ctx.scale(scaleCanvas, scaleCanvas);

    if (options.showMesh) {
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.28)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        const p0 = deformed[tri.i0];
        const p1 = deformed[tri.i1];
        const p2 = deformed[tri.i2];
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p0.x, p0.y);
      }
      ctx.stroke();
    }

    if (options.showLandmarks) {
      for (let i = 0; i < 68; i++) {
        const p = deformed[i];
        const isHovered = options.hoveredPointIndex === i;
        const isActive = options.activePointIndex === i;
        ctx.beginPath();
        ctx.arc(p.x, p.y, isActive ? 5.2 : isHovered ? 4.4 : 2.8, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#F59E0B' : isHovered ? '#60A5FA' : '#38BDF8';
        ctx.fill();
        ctx.strokeStyle = '#0B0E14';
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  u0: number, v0: number,
  u1: number, v1: number,
  u2: number, v2: number
): void {
  const dx1 = x1 - x0;
  const dy1 = y1 - y0;
  const dx2 = x2 - x0;
  const dy2 = y2 - y0;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-5) return;

  const du1 = u1 - u0;
  const dv1 = v1 - v0;
  const du2 = u2 - u0;
  const dv2 = v2 - v0;

  const a = (du1 * dy2 - du2 * dy1) / det;
  const b = (dv1 * dy2 - dv2 * dy1) / det;
  const c = (dx1 * du2 - dx2 * du1) / det;
  const d = (dx1 * dv2 - dx2 * dv1) / det;
  const e = u0 - a * x0 - c * y0;
  const f = v0 - b * x0 - d * y0;

  // Expand clip triangle ~0.65px from centroid to avoid anti-aliased seams
  const cx = (u0 + u1 + u2) / 3;
  const cy = (v0 + v1 + v2) / 3;
  const expand = (px: number, py: number): [number, number] => {
    const vx = px - cx;
    const vy = py - cy;
    const len = Math.hypot(vx, vy) || 1;
    return [px + (vx / len) * 0.65, py + (vy / len) * 0.65];
  };
  const [eu0, ev0] = expand(u0, v0);
  const [eu1, ev1] = expand(u1, v1);
  const [eu2, ev2] = expand(u2, v2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(eu0, ev0);
  ctx.lineTo(eu1, ev1);
  ctx.lineTo(eu2, ev2);
  ctx.closePath();
  ctx.clip();

  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawMouthCavity(
  ctx: CanvasRenderingContext2D,
  deformed: Point2D[],
  mAmp: number,
  scaleCanvas: number
): void {
  const innerIdx = [60, 61, 62, 63, 64, 65, 66, 67];
  const pts = innerIdx.map((i) => ({
    x: deformed[i].x * scaleCanvas,
    y: deformed[i].y * scaleCanvas,
  }));

  const alpha = Math.min(0.92, mAmp * 1.4);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();

  const topY = pts[2].y;
  const botY = pts[6].y;
  const midX = (pts[0].x + pts[4].x) / 2;

  const cavityGrad = ctx.createLinearGradient(midX, topY, midX, botY);
  cavityGrad.addColorStop(0, `rgba(28, 8, 10, ${alpha})`);
  cavityGrad.addColorStop(0.65, `rgba(18, 5, 7, ${alpha})`);
  cavityGrad.addColorStop(1, `rgba(54, 16, 18, ${alpha * 0.92})`);
  ctx.fillStyle = cavityGrad;
  ctx.fill();

  // Subtle upper teeth hint when mouth opens clearly
  if (mAmp > 0.22) {
    ctx.clip();
    ctx.fillStyle = `rgba(235, 232, 228, ${Math.min(0.55, (mAmp - 0.22) * 0.85)})`;
    ctx.beginPath();
    ctx.ellipse(midX, topY + 2 * scaleCanvas, Math.abs(pts[4].x - pts[0].x) * 0.34, 4.2 * scaleCanvas, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEyelidClosure(
  ctx: CanvasRenderingContext2D,
  deformed: Point2D[],
  blinkAmount: number,
  skinColor: string,
  scaleCanvas: number
): void {
  const drawLid = (indices: number[]) => {
    const pts = indices.map((i) => ({
      x: deformed[i].x * scaleCanvas,
      y: deformed[i].y * scaleCanvas,
    }));
    // pts[0]=outer, pts[1..2]=upper, pts[3]=inner, pts[4..5]=lower
    const upperMidY = (pts[1].y + pts[2].y) / 2;
    const lowerMidY = (pts[4].y + pts[5].y) / 2;
    const coverY = upperMidY + (lowerMidY - upperMidY) * blinkAmount;

    ctx.save();
    ctx.globalAlpha = Math.min(0.95, blinkAmount * 1.15);
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.moveTo(pts[0].x - 2, pts[0].y);
    ctx.quadraticCurveTo((pts[1].x + pts[2].x) / 2, upperMidY - 4 * scaleCanvas, pts[3].x + 2, pts[3].y);
    ctx.quadraticCurveTo((pts[4].x + pts[5].x) / 2, coverY + 2 * scaleCanvas, pts[0].x - 2, pts[0].y);
    ctx.closePath();
    ctx.fill();

    // Lash line closing downward
    ctx.strokeStyle = 'rgba(20, 15, 14, 0.78)';
    ctx.lineWidth = 2.0 * scaleCanvas;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.quadraticCurveTo((pts[1].x + pts[2].x) / 2, coverY + 1.5 * scaleCanvas, pts[3].x, pts[3].y);
    ctx.stroke();
    ctx.restore();
  };

  drawLid([36, 37, 38, 39, 40, 41]);
  drawLid([42, 43, 44, 45, 46, 47]);
}
