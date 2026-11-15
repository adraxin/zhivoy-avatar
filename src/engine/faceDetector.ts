import { buildCanonicalLandmarks } from './portraits';
import { Landmarks68, Point2D } from './types';

declare global {
  interface Window {
    faceapi?: any;
  }
}

const FACE_API_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js';
const FACE_API_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model';

let modelsLoaded = false;
let loadPromise: Promise<boolean> | null = null;

export async function ensureFaceApiModels(): Promise<boolean> {
  if (modelsLoaded && window.faceapi) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (!window.faceapi) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = FACE_API_SCRIPT_URL;
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Не удалось загрузить face-api.js с CDN'));
          document.head.appendChild(script);
        });
      }
      const api = window.faceapi;
      if (!api) return false;

      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
        api.nets.faceLandmark68TinyNet.loadFromUri(FACE_API_MODEL_URL),
      ]);
      modelsLoaded = true;
      return true;
    } catch {
      loadPromise = null;
      return false;
    }
  })();

  return loadPromise;
}

export interface DetectedPortraitResult {
  canvas: HTMLCanvasElement;
  landmarks: Landmarks68;
  detectedByAI: boolean;
  message: string;
}

/**
 * Takes an uploaded HTMLImageElement, detects face & 68 landmarks via face-api.js
 * (tinyFaceDetector + faceLandmark68TinyNet), crops/centers the portrait to 512x512,
 * and returns mapped 68 landmarks. Falls back gracefully if offline or face undetected.
 */
export async function processUploadedFaceImage(
  img: HTMLImageElement
): Promise<DetectedPortraitResult> {
  const TARGET_SIZE = 512;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = TARGET_SIZE;
  outCanvas.height = TARGET_SIZE;
  const ctx = outCanvas.getContext('2d')!;

  const ready = await ensureFaceApiModels();
  if (ready && window.faceapi) {
    try {
      const api = window.faceapi;
      const detection = await api
        .detectSingleFace(
          img,
          new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 })
        )
        .withFaceLandmarks(true);

      if (detection && detection.landmarks) {
        const box = detection.detection.box;
        const rawPts: Point2D[] = detection.landmarks.positions.map((p: any) => ({
          x: p.x,
          y: p.y,
        }));

        // Compute centered square portrait crop with comfortable headroom & chin margin
        const faceCenterX = box.x + box.width * 0.5;
        const faceCenterY = box.y + box.height * 0.44;
        const cropSize = Math.max(box.width, box.height) * 2.05;

        const sx = faceCenterX - cropSize / 2;
        const sy = faceCenterY - cropSize / 2;

        // Fill dark studio backdrop in case crop extends outside image bounds
        ctx.fillStyle = '#121721';
        ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);

        const scale = TARGET_SIZE / cropSize;
        ctx.drawImage(
          img,
          -sx * scale,
          -sy * scale,
          img.naturalWidth * scale,
          img.naturalHeight * scale
        );

        const mappedLandmarks: Landmarks68 = rawPts.map((p) => ({
          x: (p.x - sx) * scale,
          y: (p.y - sy) * scale,
        }));

        return {
          canvas: outCanvas,
          landmarks: mappedLandmarks,
          detectedByAI: true,
          message: 'Лицо автоматически распознано (68 ключевых точек).',
        };
      }
    } catch {
      // Fall through to centered fallback
    }
  }

  // Graceful fallback: center-cover crop + calibrated canonical 68 landmarks
  const minSide = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - minSide) / 2;
  const sy = (img.naturalHeight - minSide) * 0.32;
  ctx.fillStyle = '#121721';
  ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, TARGET_SIZE, TARGET_SIZE);

  return {
    canvas: outCanvas,
    landmarks: buildCanonicalLandmarks(256, 248, 114, 150, true),
    detectedByAI: false,
    message: ready
      ? 'Лицо не найдено автоматически — применена базовая сетка. Включите «Ручная коррекция точек» для подгонки.'
      : 'Нет доступа к CDN моделей — применена базовая сетка. Вы можете подправить точки вручную.',
  };
}
