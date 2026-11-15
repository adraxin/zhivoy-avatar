export interface SpeechAmplitudeCallback {
  onAmplitude: (level: number) => void;
  onStart: () => void;
  onEnd: () => void;
}

const VOWELS_RE = /[аоуэыиеёюяaeiouy]/i;
const PUNCT_PAUSE_RE = /[.,!?;:—–-]/;

/**
 * Computes a realistic virtual mouth-open envelope driven by speechSynthesis
 * boundary events and Russian syllable/vowel energy, so lips move naturally
 * in sync with spoken words without requiring external audio loopback permissions.
 */
export class SpeechManager {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private rafId: number | null = null;
  private active = false;
  private targetAmp = 0;
  private smoothAmp = 0;
  private text = '';
  private charIndex = 0;
  private startTime = 0;
  private estimatedDurationMs = 1500;
  private lastBoundaryTime = 0;

  public getAvailableVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    const voices = window.speechSynthesis.getVoices();
    // Sort Russian voices first
    return [...voices].sort((a, b) => {
      const aRu = a.lang.toLowerCase().startsWith('ru') ? 0 : 1;
      const bRu = b.lang.toLowerCase().startsWith('ru') ? 0 : 1;
      return aRu - bRu;
    });
  }

  public pickBestRussianVoice(preferredURI?: string): SpeechSynthesisVoice | null {
    const voices = this.getAvailableVoices();
    if (voices.length === 0) return null;
    if (preferredURI) {
      const found = voices.find((v) => v.voiceURI === preferredURI);
      if (found) return found;
    }
    const ruVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('ru'));
    if (ruVoices.length === 0) return voices[0];

    // Prefer natural/neural/Google/Microsoft voices
    const priorityKeywords = ['natural', 'online', 'google', 'yandex', 'milena', 'irina', 'pavel', 'dmitry', 'svetlana'];
    for (const kw of priorityKeywords) {
      const match = ruVoices.find((v) => v.name.toLowerCase().includes(kw));
      if (match) return match;
    }
    return ruVoices[0];
  }

  public stop(): void {
    this.active = false;
    this.targetAmp = 0;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
  }

  public speak(
    text: string,
    options: {
      voiceURI?: string;
      rate?: number;
      pitch?: number;
    },
    callbacks: SpeechAmplitudeCallback
  ): void {
    this.stop();

    const cleanText = text.trim();
    if (!cleanText) {
      callbacks.onEnd();
      return;
    }

    this.text = cleanText;
    this.charIndex = 0;
    this.startTime = performance.now();
    this.lastBoundaryTime = this.startTime;
    const rate = options.rate ?? 1.0;
    this.estimatedDurationMs = Math.max(900, (cleanText.length / 13) * 1000 / rate);

    const hasSynth = typeof window !== 'undefined' && 'speechSynthesis' in window;

    const startEnvelopeLoop = () => {
      this.active = true;
      callbacks.onStart();

      const tick = (now: number) => {
        if (!this.active) {
          this.smoothAmp *= 0.72;
          callbacks.onAmplitude(this.smoothAmp < 0.01 ? 0 : this.smoothAmp);
          if (this.smoothAmp >= 0.01) {
            this.rafId = requestAnimationFrame(tick);
          } else {
            callbacks.onAmplitude(0);
          }
          return;
        }

        const elapsed = now - this.startTime;
        // Fallback cursor advancement if browser doesn't fire onboundary reliably
        const fallbackIdx = Math.min(
          this.text.length - 1,
          Math.floor((elapsed / this.estimatedDurationMs) * this.text.length)
        );
        const activeIdx =
          now - this.lastBoundaryTime < 550 ? this.charIndex : fallbackIdx;

        // Sample upcoming window of characters to derive phoneme amplitude
        const ch = this.text[activeIdx] || ' ';
        const nextCh = this.text[activeIdx + 1] || ' ';
        const syllableWave = 0.5 + 0.5 * Math.sin(elapsed * 0.022);
        const microMod = 0.82 + 0.18 * Math.sin(elapsed * 0.055);

        if (PUNCT_PAUSE_RE.test(ch)) {
          this.targetAmp = 0.04;
        } else if (ch === ' ') {
          this.targetAmp = 0.14 * syllableWave;
        } else if (VOWELS_RE.test(ch) || VOWELS_RE.test(nextCh)) {
          this.targetAmp = (0.58 + 0.36 * syllableWave) * microMod;
        } else {
          this.targetAmp = (0.26 + 0.28 * syllableWave) * microMod;
        }

        // Fast attack, smooth release envelope follower
        const coeff = this.targetAmp > this.smoothAmp ? 0.38 : 0.22;
        this.smoothAmp += (this.targetAmp - this.smoothAmp) * coeff;
        callbacks.onAmplitude(Math.min(1, Math.max(0, this.smoothAmp)));

        if (!hasSynth && elapsed >= this.estimatedDurationMs) {
          this.active = false;
          callbacks.onEnd();
        }

        this.rafId = requestAnimationFrame(tick);
      };

      this.rafId = requestAnimationFrame(tick);
    };

    if (!hasSynth) {
      startEnvelopeLoop();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ru-RU';
    utterance.rate = rate;
    utterance.pitch = options.pitch ?? 1.0;

    const voice = this.pickBestRussianVoice(options.voiceURI);
    if (voice) {
      utterance.voice = voice;
    }

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.active = false;
      this.currentUtterance = null;
      callbacks.onAmplitude(0);
      callbacks.onEnd();
    };

    utterance.onstart = () => {
      startEnvelopeLoop();
    };

    utterance.onboundary = (ev) => {
      if (typeof ev.charIndex === 'number') {
        this.charIndex = Math.min(this.text.length - 1, ev.charIndex);
        this.lastBoundaryTime = performance.now();
      }
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);

    // Safety start if onstart is delayed by browser synthesis queue
    setTimeout(() => {
      if (!ended && !this.active && this.currentUtterance === utterance) {
        startEnvelopeLoop();
      }
    }, 120);
  }
}

export interface RecognitionSession {
  stop: () => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function startRussianSpeechRecognition(handlers: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}): RecognitionSession | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    handlers.onError('Браузер не поддерживает Web Speech API (распознавание речи). Используйте Chrome или Edge.');
    return null;
  }

  const recognition = new SR();
  recognition.lang = 'ru-RU';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let finalized = false;

  recognition.onresult = (event: any) => {
    let interim = '';
    let finalStr = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) {
        finalStr += transcript;
      } else {
        interim += transcript;
      }
    }
    if (interim) {
      handlers.onInterim(interim.trim());
    }
    if (finalStr.trim() && !finalized) {
      finalized = true;
      handlers.onFinal(finalStr.trim());
    }
  };

  recognition.onerror = (ev: any) => {
    const code = ev?.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      handlers.onError('Доступ к микрофону запрещён. Разрешите микрофон в настройках браузера.');
    } else if (code === 'no-speech') {
      handlers.onError('Речь не обнаружена. Попробуйте сказать громче.');
    } else if (code !== 'aborted') {
      handlers.onError(`Ошибка распознавания речи: ${code || 'неизвестно'}`);
    }
  };

  recognition.onend = () => {
    handlers.onEnd();
  };

  try {
    recognition.start();
  } catch {
    handlers.onError('Не удалось запустить микрофон.');
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // Ignore stop race
      }
    },
  };
}
