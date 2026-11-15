import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Mic,
  MicOff,
  RotateCcw,
  Save,
  Send,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  MessageSquare,
  Cpu,
} from 'lucide-react';
import {
  AvatarProfile,
  AvatarSettings,
  AvatarStatus,
  BrainConfig,
  ChatMessage,
  DemoPortraitId,
  Landmarks68,
} from './engine/types';
import { createDemoPortrait } from './engine/portraits';
import {
  computeDeformedPoints,
  createMeshState,
  MeshState,
  renderWarpedAvatar,
} from './engine/meshWarper';
import { processUploadedFaceImage } from './engine/faceDetector';
import {
  generateLocalLLMReply,
  generateOfflineReply,
} from './engine/dialogueEngine';
import {
  isSpeechRecognitionSupported,
  RecognitionSession,
  SpeechManager,
  startRussianSpeechRecognition,
} from './engine/speechEngine';

const PROFILE_STORAGE_KEY = 'live_avatar_studio_profile_v1';
const CANVAS_SIZE = 512;

const DEFAULT_SETTINGS: AvatarSettings = {
  mouthAmplitude: 1.0,
  blinkFrequency: 1.0,
  headTracking: 1.0,
  idleMotion: 1.0,
  showMeshOverlay: false,
};

const DEFAULT_BRAIN: BrainConfig = {
  mode: 'offline',
  ollamaUrl: 'http://localhost:11434/api/generate',
  ollamaModel: 'llama3.2',
  systemPrompt: 'Ты дружелюбный и остроумный виртуальный собеседник.',
  voiceURI: '',
  speechRate: 1.0,
  speechPitch: 1.0,
};

type InspectorTab = 'chat' | 'face' | 'brain';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Mutable animation state stored in refs for zero-overhead 60fps Canvas loop
  const meshRef = useRef<MeshState | null>(null);
  const defaultLandmarksRef = useRef<Landmarks68>([]);
  const baseLandmarksRef = useRef<Landmarks68>([]);
  const settingsRef = useRef<AvatarSettings>({ ...DEFAULT_SETTINGS });
  const editModeRef = useRef<boolean>(false);
  const hoveredPtRef = useRef<number | null>(null);
  const draggingPtRef = useRef<number | null>(null);
  const mouthOpenRef = useRef<number>(0);
  const lookTargetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lookSmoothRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastMouseMoveRef = useRef<number>(performance.now());
  const blinkStateRef = useRef<{
    phase: 'open' | 'closing' | 'opening';
    amount: number;
    nextAt: number;
    startedAt: number;
  }>({
    phase: 'open',
    amount: 0,
    nextAt: performance.now() + 2400,
    startedAt: 0,
  });

  const speechMgrRef = useRef<SpeechManager | null>(null);
  const recognitionRef = useRef<RecognitionSession | null>(null);
  const audioBarsRef = useRef<(HTMLDivElement | null)[]>([]);

  // React UI state
  const [sourceType, setSourceType] = useState<'demo' | 'custom'>('demo');
  const [activeDemo, setActiveDemo] = useState<DemoPortraitId>('elena');
  const [settings, setSettings] = useState<AvatarSettings>({ ...DEFAULT_SETTINGS });
  const [brain, setBrain] = useState<BrainConfig>({ ...DEFAULT_BRAIN });
  const [userName, setUserName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>('chat');
  const [editMode, setEditMode] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isAnalyzingFace, setIsAnalyzingFace] = useState<boolean>(false);
  const [detectionNote, setDetectionNote] = useState<string>('Демо-портрет · 68 точек');
  const [status, setStatus] = useState<AvatarStatus>('idle');
  const [inputText, setInputText] = useState<string>('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [llmTestResult, setLlmTestResult] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'avatar',
      text: 'Привет! Я твой автономный цифровой собеседник. Загрузи своё фото или общайся со мной прямо сейчас — голос, мимика и мозги работают локально без облачных ключей.',
      timestamp: Date.now(),
      source: 'offline',
    },
  ]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((showToast as any)._timer);
    (showToast as any)._timer = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Keep refs synced with React state
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  // Rebuild Delaunay mesh whenever base landmarks or source canvas change
  const applyPortrait = useCallback(
    (sourceCanvas: HTMLCanvasElement, landmarks: Landmarks68, defaultLms?: Landmarks68) => {
      baseLandmarksRef.current = landmarks.map((p) => ({ x: p.x, y: p.y }));
      defaultLandmarksRef.current = (defaultLms || landmarks).map((p) => ({ x: p.x, y: p.y }));
      meshRef.current = createMeshState(sourceCanvas, baseLandmarksRef.current);
    },
    []
  );

  const loadDemo = useCallback(
    (id: DemoPortraitId) => {
      const demo = createDemoPortrait(id);
      setSourceType('demo');
      setActiveDemo(id);
      setDetectionNote(`Портрет «${demo.name}» · 68 точек`);
      applyPortrait(demo.canvas, demo.landmarks);
    },
    [applyPortrait]
  );

  // Initialize SpeechManager, voices, and restore saved profile from localStorage
  useEffect(() => {
    const mgr = new SpeechManager();
    speechMgrRef.current = mgr;

    const updateVoices = () => {
      const list = mgr.getAvailableVoices();
      setVoices(list);
      setBrain((prev) => {
        if (prev.voiceURI && list.some((v) => v.voiceURI === prev.voiceURI)) return prev;
        const best = mgr.pickBestRussianVoice();
        return best ? { ...prev, voiceURI: best.voiceURI } : prev;
      });
    };

    updateVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }

    // Attempt profile restore
    let restored = false;
    try {
      const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AvatarProfile;
        if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
        if (parsed.brain) setBrain({ ...DEFAULT_BRAIN, ...parsed.brain });
        if (parsed.userName) setUserName(parsed.userName);

        if (
          parsed.sourceType === 'custom' &&
          parsed.imageDataUrl &&
          Array.isArray(parsed.landmarks) &&
          parsed.landmarks.length === 68
        ) {
          restored = true;
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = CANVAS_SIZE;
            c.height = CANVAS_SIZE;
            c.getContext('2d')!.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
            setSourceType('custom');
            setDetectionNote('Сохранённый профиль · 68 точек');
            applyPortrait(c, parsed.landmarks);
          };
          img.src = parsed.imageDataUrl;
        } else if (parsed.demoId) {
          restored = true;
          const demo = createDemoPortrait(parsed.demoId);
          setSourceType('demo');
          setActiveDemo(parsed.demoId);
          setDetectionNote(`Сохранённый профиль «${demo.name}»`);
          applyPortrait(
            demo.canvas,
            parsed.landmarks?.length === 68 ? parsed.landmarks : demo.landmarks,
            demo.landmarks
          );
        }
      }
    } catch {
      // Ignore corrupt profile
    }

    if (!restored) {
      loadDemo('elena');
    }

    return () => {
      mgr.stop();
      recognitionRef.current?.stop();
    };
  }, [applyPortrait, loadDemo]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 60FPS HTML5 Canvas Mesh Warping Loop
  useEffect(() => {
    let rafId = 0;

    const loop = (now: number) => {
      const canvas = canvasRef.current;
      const mesh = meshRef.current;

      if (canvas && mesh) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // 1. Update blink state machine
          const bs = blinkStateRef.current;
          const blinkFreq = Math.max(0.2, settingsRef.current.blinkFrequency);
          if (bs.phase === 'open' && now >= bs.nextAt) {
            bs.phase = 'closing';
            bs.startedAt = now;
          } else if (bs.phase === 'closing') {
            const p = (now - bs.startedAt) / 85;
            if (p >= 1) {
              bs.amount = 1;
              bs.phase = 'opening';
              bs.startedAt = now;
            } else {
              bs.amount = p;
            }
          } else if (bs.phase === 'opening') {
            const p = (now - bs.startedAt) / 135;
            if (p >= 1) {
              bs.amount = 0;
              bs.phase = 'open';
              bs.nextAt = now + (2200 + Math.random() * 2800) / blinkFreq;
            } else {
              bs.amount = 1 - p;
            }
          }

          // 2. Smooth gaze return after idle mouse
          if (now - lastMouseMoveRef.current > 3500) {
            lookTargetRef.current.x *= 0.97;
            lookTargetRef.current.y *= 0.97;
          }
          lookSmoothRef.current.x += (lookTargetRef.current.x - lookSmoothRef.current.x) * 0.09;
          lookSmoothRef.current.y += (lookTargetRef.current.y - lookSmoothRef.current.y) * 0.09;

          const frameParams = {
            timeSec: now * 0.001,
            blinkAmount: bs.amount,
            mouthOpen: mouthOpenRef.current,
            lookX: lookSmoothRef.current.x,
            lookY: lookSmoothRef.current.y,
            settings: settingsRef.current,
          };

          const deformed = computeDeformedPoints(mesh.basePoints, frameParams);
          renderWarpedAvatar(ctx, mesh, deformed, frameParams, {
            showMesh: settingsRef.current.showMeshOverlay,
            showLandmarks: editModeRef.current,
            hoveredPointIndex: hoveredPtRef.current,
            activePointIndex: draggingPtRef.current,
          });
        }
      }

      // Update live audio level bars directly for smooth 60fps feedback
      const amp = mouthOpenRef.current;
      const weights = [0.55, 0.9, 1.0, 0.85, 0.5];
      audioBarsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const h = Math.round(4 + amp * 14 * weights[i]);
        bar.style.height = `${h}px`;
        bar.style.backgroundColor = amp > 0.07 ? '#10B981' : '#475569';
      });

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Mouse gaze tracking & landmark point dragging
  useEffect(() => {
    const onMouseMove = (ev: MouseEvent) => {
      lastMouseMoveRef.current = performance.now();
      lookTargetRef.current.x = Math.max(-1, Math.min(1, (ev.clientX / window.innerWidth) * 2 - 1));
      lookTargetRef.current.y = Math.max(-1, Math.min(1, (ev.clientY / window.innerHeight) * 2 - 1));

      if (editModeRef.current && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = ((ev.clientX - rect.left) / rect.width) * CANVAS_SIZE;
        const cy = ((ev.clientY - rect.top) / rect.height) * CANVAS_SIZE;

        if (draggingPtRef.current !== null && meshRef.current) {
          const idx = draggingPtRef.current;
          baseLandmarksRef.current[idx] = {
            x: Math.max(12, Math.min(CANVAS_SIZE - 12, cx)),
            y: Math.max(12, Math.min(CANVAS_SIZE - 12, cy)),
          };
          meshRef.current = createMeshState(meshRef.current.sourceCanvas, baseLandmarksRef.current);
        } else {
          let best: number | null = null;
          let bestDist = 13;
          for (let i = 0; i < 68; i++) {
            const p = baseLandmarksRef.current[i];
            if (!p) continue;
            const d = Math.hypot(p.x - cx, p.y - cy);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          hoveredPtRef.current = best;
        }
      }
    };

    const onMouseUp = () => {
      draggingPtRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleCanvasMouseDown = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editMode || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = ((ev.clientX - rect.left) / rect.width) * CANVAS_SIZE;
    const cy = ((ev.clientY - rect.top) / rect.height) * CANVAS_SIZE;

    let best: number | null = null;
    let bestDist = 15;
    for (let i = 0; i < 68; i++) {
      const p = baseLandmarksRef.current[i];
      if (!p) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== null) {
      draggingPtRef.current = best;
    }
  };

  // Photo Upload & Drag-and-Drop Face Detection
  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('Выберите изображение в формате JPG, PNG или WebP.');
      return;
    }
    setIsAnalyzingFace(true);
    setDetectionNote('Поиск лица и 68 ключевых точек...');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        const result = await processUploadedFaceImage(img);
        setSourceType('custom');
        applyPortrait(result.canvas, result.landmarks);
        setDetectionNote(
          result.detectedByAI
            ? 'Лицо захвачено автоматически · 68 точек'
            : 'Базовая разметка · доступна ручная коррекция'
        );
        showToast(result.message);
      } catch {
        showToast('Не удалось обработать изображение.');
      } finally {
        setIsAnalyzingFace(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setIsAnalyzingFace(false);
      showToast('Ошибка чтения файла изображения.');
    };
    img.src = url;
  };

  // Speak response & animate mouth
  const speakResponse = useCallback(
    (text: string) => {
      const mgr = speechMgrRef.current;
      if (!mgr) return;
      mgr.speak(
        text,
        {
          voiceURI: brain.voiceURI,
          rate: brain.speechRate,
          pitch: brain.speechPitch,
        },
        {
          onStart: () => setStatus('speaking'),
          onAmplitude: (level) => {
            mouthOpenRef.current = level;
          },
          onEnd: () => {
            mouthOpenRef.current = 0;
            setStatus('idle');
          },
        }
      );
    },
    [brain.speechPitch, brain.speechRate, brain.voiceURI]
  );

  // Send message to offline engine or local Ollama / LM Studio
  const handleSendMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: Date.now(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInputText('');
    setStatus('thinking');

    let response;
    if (brain.mode === 'ollama') {
      try {
        response = await generateLocalLLMReply(
          trimmed,
          { userName, history: nextHistory },
          brain
        );
      } catch {
        showToast('Локальная LLM недоступна — использован автономный офлайн-движок.');
        response = generateOfflineReply(trimmed, { userName, history: nextHistory });
      }
    } else {
      response = generateOfflineReply(trimmed, { userName, history: nextHistory });
    }

    if (response.detectedName) {
      setUserName(response.detectedName);
    }

    const avatarMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'avatar',
      text: response.reply,
      timestamp: Date.now(),
      source: response.source,
    };
    setMessages((prev) => [...prev, avatarMsg]);
    speakResponse(response.reply);
  };

  // Microphone toggle (Web Speech API ru-RU)
  const handleMicToggle = () => {
    if (status === 'speaking') {
      speechMgrRef.current?.stop();
      mouthOpenRef.current = 0;
      setStatus('idle');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setStatus('idle');
      return;
    }

    if (!isSpeechRecognitionSupported()) {
      showToast('Распознавание речи (Web Speech API) поддерживается в Chrome, Edge и Safari.');
      return;
    }

    setStatus('listening');
    const session = startRussianSpeechRecognition({
      onInterim: (interim) => {
        setInputText(interim);
      },
      onFinal: (finalText) => {
        setInputText('');
        recognitionRef.current = null;
        handleSendMessage(finalText);
      },
      onError: (msg) => {
        showToast(msg);
      },
      onEnd: () => {
        recognitionRef.current = null;
        setStatus((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
    if (session) {
      recognitionRef.current = session;
    } else {
      setStatus('idle');
    }
  };

  // Save avatar photo, landmarks, settings, and brain config to localStorage
  const handleSaveProfile = () => {
    try {
      const mesh = meshRef.current;
      const profile: AvatarProfile = {
        sourceType,
        demoId: sourceType === 'demo' ? activeDemo : undefined,
        imageDataUrl:
          sourceType === 'custom' && mesh
            ? mesh.sourceCanvas.toDataURL('image/jpeg', 0.9)
            : undefined,
        landmarks: baseLandmarksRef.current,
        settings,
        brain,
        userName: userName || undefined,
      };
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      showToast('Профиль аватара сохранён в браузере.');
    } catch {
      showToast('Не удалось сохранить профиль (превышен лимит хранилища).');
    }
  };

  // Download standalone single-file HTML program for desktop offline use
  const handleDownloadStandalone = async () => {
    try {
      const res = await fetch('/avatar-studio.html');
      if (!res.ok) throw new Error('Fetch failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zhivoy-avatar-standalone.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Файл zhivoy-avatar-standalone.html скачан — откройте его в любом браузере на ПК.');
    } catch {
      showToast('Ошибка скачивания автономного HTML-файла.');
    }
  };

  const handleTestOllama = async () => {
    setLlmTestResult('Проверка подключения...');
    try {
      const res = await generateLocalLLMReply(
        'Скажи коротко «Привет, я на связи!»',
        { userName, history: [] },
        brain
      );
      setLlmTestResult(`Подключено: «${res.reply.slice(0, 70)}»`);
    } catch (err: any) {
      setLlmTestResult(
        `Не удалось подключиться (${err?.message || 'CORS / сервер не запущен'}). Запустите Ollama с OLLAMA_ORIGINS=*`
      );
    }
  };

  const resetLandmarks = () => {
    if (!meshRef.current || defaultLandmarksRef.current.length !== 68) return;
    baseLandmarksRef.current = defaultLandmarksRef.current.map((p) => ({ x: p.x, y: p.y }));
    meshRef.current = createMeshState(meshRef.current.sourceCanvas, baseLandmarksRef.current);
    showToast('Точки лица сброшены к исходным.');
  };

  const statusText =
    status === 'listening'
      ? 'Слушаю микрофон'
      : status === 'speaking'
      ? 'Говорю'
      : status === 'thinking'
      ? 'Формирую ответ'
      : brain.mode === 'ollama'
      ? 'Готов к общению · Локальная LLM'
      : 'Готов к общению · Офлайн-движок';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0E14] text-slate-100 select-none">
      {/* Top Bar */}
      <header className="h-14 shrink-0 px-5 flex items-center justify-between gap-6 bg-[#121721] border-b border-white/[0.08]">
        <div className="font-display text-base font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0">
          Живой Аватар
        </div>

        <div className="flex items-center gap-2.5 overflow-x-auto">
          {/* Built-in Demo Portraits Switcher */}
          <div
            className="flex items-center p-0.5 rounded-lg bg-[#0B0E14] border border-white/[0.08] shrink-0"
            role="group"
            aria-label="Готовые портреты"
          >
            <button
              type="button"
              onClick={() => loadDemo('elena')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceType === 'demo' && activeDemo === 'elena'
                  ? 'bg-[#1D2535] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Елена
            </button>
            <button
              type="button"
              onClick={() => loadDemo('artem')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceType === 'demo' && activeDemo === 'artem'
                  ? 'bg-[#1D2535] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Артём
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageFile(f);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzingFace}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#18202E] hover:bg-[#202B3D] text-slate-100 border border-white/[0.12] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Upload className="w-3.5 h-3.5 text-blue-400" />
            <span>Загрузить фото лица</span>
          </button>

          <button
            type="button"
            onClick={handleSaveProfile}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Сохранить профиль аватара</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadStandalone}
            title="Скачать полностью автономный однофайловый HTML для запуска локально на ПК"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#18202E] hover:bg-[#202B3D] text-slate-200 border border-white/[0.12] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-300" />
            <span>Скачать HTML для ПК</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_380px]">
        {/* Center Avatar Viewport */}
        <main
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const f = e.dataTransfer?.files?.[0];
            if (f) handleImageFile(f);
          }}
          className="relative flex flex-col items-center justify-center p-5 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_50%_42%,#141C2B_0%,#0B0E14_74%)]"
        >
          <div className="relative w-full max-w-[512px] aspect-square max-h-[calc(100vh-225px)] rounded-2xl overflow-hidden bg-[#0E131D] border border-white/[0.12] shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              onMouseDown={handleCanvasMouseDown}
              className={`w-full h-full block ${editMode ? 'cursor-crosshair' : 'cursor-default'}`}
            />

            {editMode && (
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-[#0B0E14]/90 border border-sky-400/35 text-xs text-sky-100">
                <span>Перетащите голубые точки на глаза, нос, губы и контур лица</span>
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  className="px-2.5 py-1 rounded bg-[#1D2535] hover:bg-[#273247] text-white font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Готово
                </button>
              </div>
            )}

            {isAnalyzingFace && (
              <div className="absolute inset-0 bg-[#0B0E14]/80 flex flex-col items-center justify-center gap-2 text-sm text-slate-200">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <span>Определяю ключевые точки лица...</span>
              </div>
            )}

            {isDragOver && (
              <div className="absolute inset-0 bg-[#0F172A]/90 border-2 border-dashed border-blue-500 rounded-2xl flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                <Upload className="w-6 h-6 text-blue-400" />
                <span className="text-sm font-semibold text-white">
                  Отпустите фото для захвата лица
                </span>
                <span className="text-xs text-slate-400">JPG, PNG или WebP</span>
              </div>
            )}
          </div>

          {/* Stage Metadata & Live Amplitude Meter */}
          <div className="mt-3.5 w-full max-w-[512px] flex items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              {status === 'listening' ? (
                <Mic className="w-3.5 h-3.5 text-red-400" />
              ) : status === 'speaking' ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden="true" />
              )}
              <span>{statusText}</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="truncate max-w-[230px]">{detectionNote}</span>
              <div className="flex items-end gap-[3px] h-4" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((idx) => (
                  <div
                    key={idx}
                    ref={(el) => {
                      audioBarsRef.current[idx] = el;
                    }}
                    className="w-[3px] h-1 rounded-sm bg-slate-600 transition-[height] duration-75"
                  />
                ))}
              </div>
            </div>
          </div>
        </main>

        {/* Right Inspector Sidebar */}
        <aside className="flex flex-col min-h-0 bg-[#121721] border-l border-white/[0.08]">
          {/* Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1.5 bg-[#0E121B] border-b border-white/[0.08]">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-[#1B2333] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Диалог</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('face')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'face'
                  ? 'bg-[#1B2333] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Лицо</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('brain')}
              className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'brain'
                  ? 'bg-[#1B2333] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Мозги</span>
            </button>
          </div>

          {/* Tab 1: Dialogue */}
          {activeTab === 'chat' && (
            <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
              <div className="flex-1 min-h-0 overflow-y-auto studio-scroll space-y-3 pr-1 select-text">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      m.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-[#1B3358] text-slate-50 border border-blue-500/25'
                          : 'bg-[#18202E] text-slate-200 border border-white/[0.07]'
                      }`}
                    >
                      <div className="text-[11px] text-slate-400 mb-1 flex items-center gap-1.5">
                        <span>{m.role === 'user' ? 'Вы' : 'Аватар'}</span>
                        {m.source && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{m.source === 'ollama' ? 'Локальная LLM' : 'Офлайн'}</span>
                          </>
                        )}
                      </div>
                      <div>{m.text}</div>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between text-xs text-slate-400">
                <span>
                  {userName ? `Имя в памяти: ${userName}` : 'Имя пользователя: не задано'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setMessages([
                      {
                        id: `reset-${Date.now()}`,
                        role: 'avatar',
                        text: 'Диалог очищен. Готов к новому разговору!',
                        timestamp: Date.now(),
                        source: 'offline',
                      },
                    ])
                  }
                  className="px-2.5 py-1 rounded-md bg-[#18202E] hover:bg-[#222D40] text-slate-300 border border-white/[0.08] cursor-pointer"
                >
                  Очистить
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Face Calibration */}
          {activeTab === 'face' && (
            <div className="flex-1 min-h-0 overflow-y-auto studio-scroll p-4 space-y-5">
              <div className="space-y-2 pb-4 border-b border-white/[0.08]">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="mouthAmp" className="text-slate-200 font-medium">
                    Амплитуда рта
                  </label>
                  <span className="font-mono-num text-slate-400">
                    {settings.mouthAmplitude.toFixed(2)}×
                  </span>
                </div>
                <input
                  id="mouthAmp"
                  type="range"
                  min={0.3}
                  max={2.0}
                  step={0.05}
                  value={settings.mouthAmplitude}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, mouthAmplitude: parseFloat(e.target.value) }))
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-2 pb-4 border-b border-white/[0.08]">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="blinkFreq" className="text-slate-200 font-medium">
                    Частота моргания
                  </label>
                  <span className="font-mono-num text-slate-400">
                    {settings.blinkFrequency.toFixed(2)}×
                  </span>
                </div>
                <input
                  id="blinkFreq"
                  type="range"
                  min={0.2}
                  max={2.5}
                  step={0.05}
                  value={settings.blinkFrequency}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, blinkFrequency: parseFloat(e.target.value) }))
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-2 pb-4 border-b border-white/[0.08]">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="headTrack" className="text-slate-200 font-medium">
                    Слежение за курсором
                  </label>
                  <span className="font-mono-num text-slate-400">
                    {settings.headTracking.toFixed(2)}×
                  </span>
                </div>
                <input
                  id="headTrack"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={settings.headTracking}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, headTracking: parseFloat(e.target.value) }))
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-2 pb-4 border-b border-white/[0.08]">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="idleMotion" className="text-slate-200 font-medium">
                    Живое покачивание головы
                  </label>
                  <span className="font-mono-num text-slate-400">
                    {settings.idleMotion.toFixed(2)}×
                  </span>
                </div>
                <input
                  id="idleMotion"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={settings.idleMotion}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, idleMotion: parseFloat(e.target.value) }))
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 text-xs text-slate-200 cursor-pointer">
                  <span>Показать треугольную сетку</span>
                  <input
                    type="checkbox"
                    checked={settings.showMeshOverlay}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, showMeshOverlay: e.target.checked }))
                    }
                    className="accent-blue-500 w-4 h-4 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 text-xs text-slate-200 cursor-pointer">
                  <span>Ручная коррекция точек</span>
                  <input
                    type="checkbox"
                    checked={editMode}
                    onChange={(e) => setEditMode(e.target.checked)}
                    className="accent-blue-500 w-4 h-4 rounded cursor-pointer"
                  />
                </label>

                <button
                  type="button"
                  onClick={resetLandmarks}
                  className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium bg-[#18202E] hover:bg-[#212C3F] text-slate-200 border border-white/[0.1] transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Сбросить точки к исходным</span>
                </button>
              </div>

              <p className="text-xs leading-relaxed text-slate-400 p-3 rounded-lg bg-[#0D1119] border border-white/[0.06]">
                Если фото сделано в необычном ракурсе, включите «Ручная коррекция точек» и
                перетащите маркеры точно на углы глаз и контур губ.
              </p>
            </div>
          )}

          {/* Tab 3: Brain & Voice */}
          {activeTab === 'brain' && (
            <div className="flex-1 min-h-0 overflow-y-auto studio-scroll p-4 space-y-5">
              <div className="space-y-2 pb-4 border-b border-white/[0.08]">
                <span className="block text-xs text-slate-400">Интеллект аватара</span>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0B0E14] border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setBrain((b) => ({ ...b, mode: 'offline' }))}
                    className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      brain.mode === 'offline'
                        ? 'bg-[#1D2535] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Встроенный (Офлайн)
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrain((b) => ({ ...b, mode: 'ollama' }))}
                    className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      brain.mode === 'ollama'
                        ? 'bg-[#1D2535] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Ollama / LM Studio
                  </button>
                </div>
              </div>

              {brain.mode === 'ollama' && (
                <div className="space-y-3 pb-4 border-b border-white/[0.08]">
                  <div className="text-xs font-medium text-slate-200">
                    Подключить локальную нейросеть (Ollama / LM Studio)
                  </div>
                  <div>
                    <label htmlFor="ollamaUrl" className="block text-[11px] text-slate-400 mb-1">
                      Адрес локального API
                    </label>
                    <input
                      id="ollamaUrl"
                      type="text"
                      value={brain.ollamaUrl}
                      onChange={(e) => setBrain((b) => ({ ...b, ollamaUrl: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E14] border border-white/[0.12] text-xs text-slate-100 font-mono-num focus:border-blue-500 outline-none select-text"
                    />
                  </div>
                  <div>
                    <label htmlFor="ollamaModel" className="block text-[11px] text-slate-400 mb-1">
                      Модель
                    </label>
                    <input
                      id="ollamaModel"
                      type="text"
                      value={brain.ollamaModel}
                      onChange={(e) => setBrain((b) => ({ ...b, ollamaModel: e.target.value }))}
                      placeholder="llama3.2 / qwen2.5 / gemma2"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E14] border border-white/[0.12] text-xs text-slate-100 focus:border-blue-500 outline-none select-text"
                    />
                  </div>
                  <div>
                    <label htmlFor="sysPrompt" className="block text-[11px] text-slate-400 mb-1">
                      Характер и роль
                    </label>
                    <textarea
                      id="sysPrompt"
                      rows={2}
                      value={brain.systemPrompt}
                      onChange={(e) => setBrain((b) => ({ ...b, systemPrompt: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E14] border border-white/[0.12] text-xs text-slate-100 focus:border-blue-500 outline-none select-text"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleTestOllama}
                    className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-[#18202E] hover:bg-[#202B3D] text-slate-100 border border-white/[0.1] cursor-pointer"
                  >
                    Проверить локальную модель
                  </button>
                  {llmTestResult && (
                    <div className="text-[11px] text-slate-300 bg-[#0B0E14] border border-white/[0.08] rounded-lg p-2.5 leading-relaxed select-text">
                      {llmTestResult}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Для Ollama запустите сервер с <span className="font-mono-num text-slate-300">OLLAMA_ORIGINS=*</span>. Поддерживаются также эндпоинты LM Studio (<span className="font-mono-num text-slate-300">/v1/chat/completions</span>).
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label htmlFor="voicePicker" className="block text-xs text-slate-400 mb-1.5">
                    Системный голос (SpeechSynthesis)
                  </label>
                  <select
                    id="voicePicker"
                    value={brain.voiceURI}
                    onChange={(e) => setBrain((b) => ({ ...b, voiceURI: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0E14] border border-white/[0.12] text-xs text-slate-100 focus:border-blue-500 outline-none"
                  >
                    {voices.length === 0 ? (
                      <option value="">Системный голос по умолчанию</option>
                    ) : (
                      voices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="speechRate" className="text-slate-200">
                      Скорость речи
                    </label>
                    <span className="font-mono-num text-slate-400">
                      {brain.speechRate.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    id="speechRate"
                    type="range"
                    min={0.7}
                    max={1.4}
                    step={0.05}
                    value={brain.speechRate}
                    onChange={(e) =>
                      setBrain((b) => ({ ...b, speechRate: parseFloat(e.target.value) }))
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="speechPitch" className="text-slate-200">
                      Тон голоса
                    </label>
                    <span className="font-mono-num text-slate-400">
                      {brain.speechPitch.toFixed(2)}
                    </span>
                  </div>
                  <input
                    id="speechPitch"
                    type="range"
                    min={0.7}
                    max={1.3}
                    step={0.05}
                    value={brain.speechPitch}
                    onChange={(e) =>
                      setBrain((b) => ({ ...b, speechPitch: parseFloat(e.target.value) }))
                    }
                    className="w-full studio-slider"
                  />
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Bottom Speech & Text Bar */}
      <footer className="h-[76px] shrink-0 px-5 flex items-center gap-3 bg-[#121721] border-t border-white/[0.08]">
        <button
          type="button"
          onClick={handleMicToggle}
          className={`h-11 px-5 rounded-xl font-medium text-sm inline-flex items-center gap-2.5 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            status === 'listening'
              ? 'bg-red-950/80 border-red-500 text-red-100 hover:bg-red-900/80'
              : status === 'speaking'
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100 hover:bg-emerald-900/80'
              : 'bg-[#18202E] border-white/[0.14] text-slate-100 hover:bg-[#222D40]'
          }`}
        >
          {status === 'listening' ? (
            <>
              <MicOff className="w-4 h-4 text-red-400" />
              <span>Слушаю...</span>
            </>
          ) : status === 'speaking' ? (
            <>
              <VolumeX className="w-4 h-4 text-emerald-400" />
              <span>Говорю (Прервать)</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 text-blue-400" />
              <span>Говорить</span>
            </>
          )}
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputText);
          }}
          className="flex-1 flex items-center gap-2.5"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Напишите сообщение аватару (например: «Меня зовут Максим» или «Расскажи шутку»)..."
            className="flex-1 h-11 px-4 rounded-xl bg-[#0B0E14] border border-white/[0.12] text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 outline-none select-text"
          />
          <button
            type="submit"
            className="h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>Отправить</span>
          </button>
        </form>
      </footer>

      {/* Notification Toast */}
      {toast && (
        <div
          role="status"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#1A2232] border border-white/[0.14] text-xs text-slate-100 shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
