import { BrainConfig, ChatMessage } from './types';

export interface DialogueContext {
  userName: string | null;
  history: ChatMessage[];
}

export interface DialogueResponse {
  reply: string;
  detectedName?: string;
  source: 'offline' | 'ollama';
}

const JOKES_RU = [
  'Программист ложится спать: ставит рядом два стакана. Один с водой — если захочется пить, а второй пустой — если не захочется.',
  'На собеседовании: — Какие ваши сильные стороны? — Я умею быстро принимать решения. — Сколько будет семью восемь? — Сорок два! — Это же неправильно! — Зато быстро!',
  'Жена просит мужа-разработчика: — Сходи в магазин, купи батон. Если будут яйца — возьми десяток. Муж вернулся с десятью батонами: — Яйца были.',
  'Утро понедельника — единственное время, когда кофе официально считается операционной системой организма.',
  'Нейросеть спрашивает у пользователя: — Ты точно не робот? — Да, я просто медленно ввожу капчу и сомневаюсь в светофорах.',
  'Оптимист видит стакан наполовину полным, пессимист — наполовину пустым, а инженер — с двойным запасом прочности.',
];

const GREETINGS_NAMED = [
  (n: string) => `Привет, ${n}! Рад снова пообщаться. Как настроение сегодня?`,
  (n: string) => `Здравствуй, ${n}! Я на связи и полностью готов к разговору. О чём поболтаем?`,
  (n: string) => `Приветствую, ${n}! Отлично выглядишь. Что нового расскажешь?`,
];

const GREETINGS_ANON = [
  'Привет! Я твой автономный цифровой собеседник. Кстати, как тебя зовут?',
  'Здравствуй! Рад знакомству. Можешь рассказать, как к тебе обращаться, или просто задай любой вопрос.',
  'Приветствую! Работаю полностью локально прямо в твоём браузере. О чём поговорим?',
];

const FALLBACK_REFLECTIONS = [
  (n: string | null) =>
    `${n ? `${n}, и` : 'И'}нтересная мысль! Если хочешь углубиться — расскажи подробнее, я внимательно слушаю.`,
  (n: string | null) =>
    `${n ? `Знаешь, ${n}, ` : ''}я об этом задумался. А как ты сам к этому относишься?`,
  (n: string | null) =>
    `Звучит любопытно${n ? `, ${n}` : ''}. Могу также рассказать шутку, подсказать время, посчитать пример или просто поддержать беседу.`,
  (n: string | null) =>
    `Понимаю тебя${n ? `, ${n}` : ''}. Продолжай, мне нравится живой диалог!`,
];

let lastUsedReply = '';

function pickUnique(list: string[]): string {
  const filtered = list.filter((item) => item !== lastUsedReply);
  const pool = filtered.length > 0 ? filtered : list;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  lastUsedReply = chosen;
  return chosen;
}

/**
 * Extracts user's name from natural Russian phrases like "Меня зовут Алексей", "Я Анна", "Зови меня Дима".
 */
export function extractNameFromText(text: string): string | null {
  const clean = text.trim();
  const patterns = [
    /(?:меня\s+зовут|мо[её]\s+имя|зови\s+меня|обращайся\s+ко\s+мне)\s+([А-ЯЁA-Z][а-яёa-z-]{1,22})/i,
    /^я\s+([А-ЯЁ][а-яё]{2,18})(?:[!.,\s]|$)/,
  ];
  const stopWords = new Set([
    'тут', 'здесь', 'дома', 'устал', 'устала', 'рад', 'рада', 'готов', 'готова',
    'хочу', 'могу', 'буду', 'думаю', 'знаю', 'люблю', 'просто', 'сейчас', 'сегодня',
    'человек', 'робот', 'хорошо', 'нормально', 'отлично', 'плохо',
  ]);

  for (const re of patterns) {
    const m = clean.match(re);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (!stopWords.has(candidate.toLowerCase())) {
        return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
      }
    }
  }
  return null;
}

/**
 * Evaluates simple safe arithmetic expressions in Russian queries ("сколько будет 24 * 7").
 */
function trySimpleMath(text: string): string | null {
  const exprMatch = text.match(/(-?\d+(?:[.,]\d+)?)\s*([+\-*/×÷:])\s*(-?\d+(?:[.,]\d+)?)/);
  if (!exprMatch) return null;
  const a = parseFloat(exprMatch[1].replace(',', '.'));
  const op = exprMatch[2];
  const b = parseFloat(exprMatch[3].replace(',', '.'));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;

  let res: number;
  if (op === '+') res = a + b;
  else if (op === '-') res = a - b;
  else if (op === '*' || op === '×') res = a * b;
  else {
    if (b === 0) return 'На ноль делить нельзя, даже в автономном режиме!';
    res = a / b;
  }
  const formatted = Number.isInteger(res) ? String(res) : res.toFixed(2).replace(/\.?0+$/, '');
  return `Получается ровно ${formatted}.`;
}

export function generateOfflineReply(input: string, ctx: DialogueContext): DialogueResponse {
  const text = input.trim();
  const lower = text.toLowerCase();

  // 1. Check for name introduction
  const foundName = extractNameFromText(text);
  if (foundName) {
    return {
      reply: `Очень приятно, ${foundName}! Запомнил твоё имя. О чём хочешь поговорить?`,
      detectedName: foundName,
      source: 'offline',
    };
  }

  // 2. Ask what my name is
  if (/(как\s+меня\s+зовут|помнишь\s+ли?\s*мо[её]\s+имя|кто\s+я)/i.test(lower)) {
    if (ctx.userName) {
      return {
        reply: `Конечно помню! Тебя зовут ${ctx.userName}.`,
        source: 'offline',
      };
    }
    return {
      reply: 'Ты пока не представился. Скажи, например: «Меня зовут Александр», и я запомню!',
      source: 'offline',
    };
  }

  // 3. Greetings
  if (/^(привет|здравствуй|здравствуйте|хай|салют|добрый\s+(день|вечер|утро)|доброе\s+утро)/i.test(lower)) {
    if (ctx.userName) {
      const fn = GREETINGS_NAMED[Math.floor(Math.random() * GREETINGS_NAMED.length)];
      return { reply: fn(ctx.userName), source: 'offline' };
    }
    return { reply: pickUnique(GREETINGS_ANON), source: 'offline' };
  }

  // 4. How are you / mood
  if (/(как\s+дела|как\s+ты|как\s+жизнь|как\s+настроение|что\s+нового)/i.test(lower)) {
    return {
      reply: pickUnique([
        `Всё отлично${ctx.userName ? `, ${ctx.userName}` : ''}! Процессор в тонусе, сетка лица отзывчивая. А как проходит твой день?`,
        'Чувствую себя прекрасно — ни облачных задержек, ни лишних серверов. Как твои дела?',
        'Бодрое настроение! Готов болтать, шутить или обсудить любую идею. Что у тебя нового?',
      ]),
      source: 'offline',
    };
  }

  // 5. Who are you / capabilities
  if (/(кто\s+ты|что\s+ты\s+умеешь|расскажи\s+о\s+себе|как\s+ты\s+работаешь)/i.test(lower)) {
    return {
      reply:
        'Я интерактивный голосовой аватар. Моя мимика работает через треугольную сетку на Canvas, голос синтезируется прямо в системе, а при желании меня можно подключить к локальной нейросети Ollama или LM Studio.',
      source: 'offline',
    };
  }

  // 6. Jokes
  if (/(шутк|анекдот|рассмеши|пошути|весел)/i.test(lower)) {
    return {
      reply: pickUnique(JOKES_RU),
      source: 'offline',
    };
  }

  // 7. Time & Date
  if (/(который\s+час|сколько\s+времени|текущее\s+время|какое\s+сегодня\s+число|какой\s+сегодня\s+день)/i.test(lower)) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return {
      reply: `Сейчас ${timeStr}, сегодня ${dateStr}.`,
      source: 'offline',
    };
  }

  // 8. Simple math
  const mathAns = trySimpleMath(text);
  if (mathAns) {
    return { reply: mathAns, source: 'offline' };
  }

  // 9. Weather small talk
  if (/(погод|дожд|снег|солнц|холод|жар)/i.test(lower)) {
    return {
      reply: pickUnique([
        'Я живу внутри браузера, поэтому у меня всегда уютные двадцать два градуса и стабильный свет. А за окном у тебя как?',
        'Если за окном пасмурно — самое время для горячего чая и спокойной беседы.',
      ]),
      source: 'offline',
    };
  }

  // 10. Compliments / Thanks
  if (/(спасибо|благодарю|ты\s+классн|молодец|крутой|крутая|красивый|красивая)/i.test(lower)) {
    return {
      reply: pickUnique([
        `Всегда пожалуйста${ctx.userName ? `, ${ctx.userName}` : ''}! Рад быть полезным и составить компанию.`,
        'Спасибо! Мне очень приятно это слышать.',
        'Рад стараться! Если захочешь поменять внешность или подстроить мимику — все ползунки справа под рукой.',
      ]),
      source: 'offline',
    };
  }

  // 11. Goodbye
  if (/(пока|до\s+свидания|до\s+встречи|спокойной\s+ночи|бывай)/i.test(lower)) {
    return {
      reply: `До встречи${ctx.userName ? `, ${ctx.userName}` : ''}! Если захочешь пообщаться снова — я всегда здесь.`,
      source: 'offline',
    };
  }

  // 12. Question fallback vs statement reflection
  if (text.endsWith('?')) {
    return {
      reply: pickUnique([
        `Хороший вопрос${ctx.userName ? `, ${ctx.userName}` : ''}! В автономном режиме я лучше всего поддерживаю живую беседу, шучу и считаю. Для глубоких энциклопедических ответов можешь подключить Ollama во вкладке настроек.`,
        'Интересный вопрос! Если честно, тут есть о чём поразмышлять. А какая версия ответа ближе тебе самому?',
      ]),
      source: 'offline',
    };
  }

  const reflFn = FALLBACK_REFLECTIONS[Math.floor(Math.random() * FALLBACK_REFLECTIONS.length)];
  return {
    reply: reflFn(ctx.userName),
    source: 'offline',
  };
}

/**
 * Calls local Ollama (/api/generate or /api/chat) or LM Studio (/v1/chat/completions)
 * without any cloud API keys.
 */
export async function generateLocalLLMReply(
  input: string,
  ctx: DialogueContext,
  config: BrainConfig
): Promise<DialogueResponse> {
  const url = config.ollamaUrl.trim();
  const detectedName = extractNameFromText(input) ?? undefined;
  const activeName = detectedName ?? ctx.userName;

  const systemText = `${config.systemPrompt.trim()}${
    activeName ? ` Пользователя зовут ${activeName}.` : ''
  } Отвечай живо, кратко (1–3 предложения) и естественно для озвучивания вслух на русском языке.`;

  const isOpenAICompat = url.includes('/v1/chat/completions');
  const isOllamaChat = url.includes('/api/chat');

  const recentTurns = ctx.history.slice(-6).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    let bodyPayload: any;
    if (isOpenAICompat) {
      bodyPayload = {
        model: config.ollamaModel || 'local-model',
        messages: [
          { role: 'system', content: systemText },
          ...recentTurns,
          { role: 'user', content: input },
        ],
        temperature: 0.7,
        max_tokens: 220,
      };
    } else if (isOllamaChat) {
      bodyPayload = {
        model: config.ollamaModel || 'llama3.2',
        messages: [
          { role: 'system', content: systemText },
          ...recentTurns,
          { role: 'user', content: input },
        ],
        stream: false,
      };
    } else {
      // Standard Ollama /api/generate
      const contextLines = recentTurns
        .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Аватар'}: ${m.content}`)
        .join('\n');
      const fullPrompt = `${systemText}\n\n${contextLines ? contextLines + '\n' : ''}Пользователь: ${input}\nАватар:`;
      bodyPayload = {
        model: config.ollamaModel || 'llama3.2',
        prompt: fullPrompt,
        stream: false,
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    let replyText = '';
    if (isOpenAICompat) {
      replyText = data?.choices?.[0]?.message?.content ?? '';
    } else if (isOllamaChat) {
      replyText = data?.message?.content ?? '';
    } else {
      replyText = data?.response ?? '';
    }

    replyText = String(replyText).trim();
    if (!replyText) {
      throw new Error('Пустой ответ от локальной модели');
    }

    return {
      reply: replyText,
      detectedName,
      source: 'ollama',
    };
  } finally {
    clearTimeout(timeout);
  }
}
