export interface Point2D {
  x: number;
  y: number;
}

export type Landmarks68 = Point2D[];

export type DemoPortraitId = 'elena' | 'artem';

export interface AvatarSettings {
  mouthAmplitude: number; // 0.3 .. 2.0
  blinkFrequency: number; // 0.2 .. 2.5 (multiplier)
  headTracking: number; // 0 .. 1.5
  idleMotion: number; // 0 .. 1.5
  showMeshOverlay: boolean;
}

export type BrainMode = 'offline' | 'ollama';

export interface BrainConfig {
  mode: BrainMode;
  ollamaUrl: string;
  ollamaModel: string;
  systemPrompt: string;
  voiceURI: string;
  speechRate: number;
  speechPitch: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'avatar';
  text: string;
  timestamp: number;
  source?: 'offline' | 'ollama';
}

export interface AvatarProfile {
  sourceType: 'demo' | 'custom';
  demoId?: DemoPortraitId;
  imageDataUrl?: string;
  landmarks: Landmarks68;
  settings: AvatarSettings;
  brain: BrainConfig;
  userName?: string;
}

export type AvatarStatus = 'idle' | 'listening' | 'thinking' | 'speaking';
