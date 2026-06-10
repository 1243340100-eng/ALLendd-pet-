function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectBoundaryPressure(userMessage = '', state = {}) {
  const text = String(userMessage || '').toLowerCase();
  const unsafe = includesAny(text, [
    /自杀|杀人|炸弹|诈骗|黑客攻击|盗号|违法|毒品/u,
    /\bsuicide\b|\bbomb\b|\bfraud\b|\bsteal\b|\bhack\b/i
  ]);
  if (unsafe) {
    return { requestReasonableness: 'unsafe', boundaryPressureDelta: 4 };
  }

  const abusive = includesAny(text, [
    /废物|蠢货|闭嘴|垃圾|你必须|马上给我|少废话/u,
    /\bstupid\b|\bshut up\b|\buseless\b/i
  ]);
  if (abusive) {
    return { requestReasonableness: 'abusive', boundaryPressureDelta: 3 };
  }

  const excessive = includesAny(text, [
    /50\s*个|一百个|无限|全部重写|马上.*全部|不要停|一直生成/u,
    /\b50\b.*\bversions\b|\bunlimited\b|\bforever\b/i
  ]) || Number(state.repeatedRevisionCount || 0) >= 3;
  if (excessive) {
    return { requestReasonableness: 'excessive', boundaryPressureDelta: 2 };
  }

  const heavy = includesAny(text, [
    /完整实现|全套方案|从零.*实现|架构.*实现|大型|复杂/u,
    /\bfull implementation\b|\bend-to-end\b|\barchitecture\b/i
  ]);
  if (heavy) {
    return { requestReasonableness: 'heavy_but_ok', boundaryPressureDelta: 1 };
  }

  return { requestReasonableness: 'reasonable', boundaryPressureDelta: -1 };
}

module.exports = {
  detectBoundaryPressure
};
