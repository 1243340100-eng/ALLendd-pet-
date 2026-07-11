const EMOTIONS = Object.freeze([
  'happy',
  'disgusted',
  'tsundere',
  'shocked',
  'angry',
  'blushing',
  'helpless'
]);

const EMOTION_SET = new Set(EMOTIONS);
const DEFAULT_EMOTION = 'tsundere';
const MAX_CONTEXT_CHARS = 420;

function sanitizeEmotionContext(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' [code omitted] ')
    .replace(/`[^`\r\n]{1,240}`/g, ' [code omitted] ')
    .replace(/\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, ' [local path] ')
    .replace(/\\\\[^\\\s]+\\[^\s]+/g, ' [network path] ')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/gi, ' [secret] ')
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*\S+/gi, ' [secret] ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTEXT_CHARS);
}

function parseEmotionLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (EMOTION_SET.has(normalized)) return normalized;

  const match = normalized.match(/\b(happy|disgusted|tsundere|shocked|angry|blushing|helpless)\b/);
  return match && EMOTION_SET.has(match[1]) ? match[1] : null;
}

function inferEmotionFallback(userText, assistantReply) {
  const text = `${userText || ''}\n${assistantReply || ''}`.toLowerCase();

  if (/(谢谢|感谢|喜欢你|可爱|漂亮|夸|love you|thank|cute|adorable|praise)/i.test(text)) {
    return 'blushing';
  }
  if (/(危险|禁止|拒绝|不能执行|破坏|删除系统|恶意|高危|fatal|danger|forbidden|destructive)/i.test(text)) {
    return 'angry';
  }
  if (/(震惊|居然|竟然|不可能|天啊|什么[？！!?]|surpris|shocked|unbelievable)/i.test(text)) {
    return 'shocked';
  }
  if (/(无奈|又来|反复|算了|没办法|唉|helpless|again|repeated)/i.test(text)) {
    return 'helpless';
  }
  if (/(嫌弃|笨蛋|小白|杂鱼|离谱|脏乱|disgust|sloppy|silly)/i.test(text)) {
    return 'disgusted';
  }
  if (/(成功|完成|很好|太好了|开心|恭喜|解决了|success|great|done|happy)/i.test(text)) {
    return 'happy';
  }
  return DEFAULT_EMOTION;
}

function buildEmotionMessages(userText, assistantReply) {
  const safeUserText = sanitizeEmotionContext(userText);
  const safeAssistantReply = sanitizeEmotionContext(assistantReply);
  return [
    {
      role: 'system',
      content: [
        'Classify the assistant reply into exactly one animation label.',
        `Allowed labels: ${EMOTIONS.join(', ')}.`,
        'happy: success, relief, encouragement, or cheerful warmth.',
        'disgusted: light low-risk teasing about something sloppy, silly, or unpleasant.',
        'tsundere: proud, firm, composed, guarded, or neutral default.',
        'shocked: surprise, sudden alarm, or an unexpected discovery.',
        'angry: serious refusal, destructive danger, or forceful protection.',
        'blushing: praise, affection, gratitude, or flustered warmth.',
        'helpless: resignation, repeated mistakes, weary frustration, or a sigh.',
        'Return only the lowercase label. No punctuation or explanation.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `User context: ${safeUserText || '[omitted]'}`,
        `Assistant reply: ${safeAssistantReply || '[omitted]'}`
      ].join('\n')
    }
  ];
}

async function classifyResponseEmotion(config, userText, assistantReply, fetchImpl = global.fetch) {
  const fallback = inferEmotionFallback(userText, assistantReply);
  if (!config?.apiKey || !config?.endpoint || !config?.model || typeof fetchImpl !== 'function') {
    return { emotion: fallback, source: 'fallback' };
  }

  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildEmotionMessages(userText, assistantReply),
        temperature: 0,
        max_tokens: 8,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Emotion API request failed: ${response.status}`);
    }

    const data = await response.json();
    const emotion = parseEmotionLabel(data?.choices?.[0]?.message?.content);
    if (!emotion) {
      throw new Error('Emotion API returned an invalid label.');
    }

    return {
      emotion,
      source: 'ai',
      model: data.model || config.model
    };
  } catch (error) {
    return {
      emotion: fallback,
      source: 'fallback',
      error: String(error?.message || error).slice(0, 160)
    };
  }
}

module.exports = {
  EMOTIONS,
  DEFAULT_EMOTION,
  sanitizeEmotionContext,
  parseEmotionLabel,
  inferEmotionFallback,
  buildEmotionMessages,
  classifyResponseEmotion
};
