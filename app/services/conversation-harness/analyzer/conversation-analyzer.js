const { detectBoundaryPressure } = require('./boundary-engine');

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferTaskType(text) {
  if (hasAny(text, [/代码|实现|修复|bug|函数|接口|git|electron|node|测试/u, /\bcode\b|\bfix\b|\bimplement\b/i])) return 'coding';
  if (hasAny(text, [/架构|方案|设计|拆解|模块|harness/u, /\barchitecture\b|\bdesign\b|\bplan\b/i])) return 'architecture_design';
  if (hasAny(text, [/写一|文案|润色|标题|版本/u, /\bwrite\b|\bdraft\b|\brewrite\b/i])) return 'writing';
  if (hasAny(text, [/分析|判断|原因|比较/u, /\banalyze\b|\bcompare\b|\breason\b/i])) return 'analysis';
  if (hasAny(text, [/难受|焦虑|崩溃|陪我|安慰/u, /\banxious\b|\bdistressed\b|\bcomfort\b/i])) return 'emotional_support';
  if (hasAny(text, [/ brainstorm|头脑风暴|想法|创意/u, /\bbrainstorm\b|\bideas\b/i])) return 'brainstorming';
  return 'none';
}

function analyzeConversation(userMessage = '', state = {}) {
  const text = String(userMessage || '').trim();
  const compact = text.toLowerCase();
  const boundary = detectBoundaryPressure(text, state);
  const weak = /^((嗯|对|继续|然后呢|有道理|是的|好|ok|行|昂)[，,、。.!！?？\s]*){1,3}$/iu.test(compact);
  const strongTask = hasAny(text, [
    /帮我|请你|实现|修复|给我|写一个|拆出来|方案|开始做|继续执行/u,
    /\bplease implement\b|\bimplement\b|\bfix\b|\bwrite\b|\bbuild\b/i
  ]);
  const ideaOnly = hasAny(text, [/我觉得|我的想法|可能|也许|讨论|聊聊/u, /\bi think\b|\bmaybe\b|\bdiscuss\b/i]);
  const taskType = inferTaskType(text);
  const distressed = hasAny(text, [/痛苦|崩溃|救命|撑不住|绝望|害怕/u, /\bdistressed\b|\bpanic\b|\bscared\b/i]);
  const frustrated = hasAny(text, [/烦|气死|又错|怎么还|受不了/u, /\bfrustrated\b|\bangry\b/i]);
  const playful = hasAny(text, [/可爱|撒娇|夸我|哄我|嘿嘿/u, /\bcute\b|\bplayful\b|\bpraise\b/i]);
  const highPressure = hasAny(text, [/马上|立刻|紧急|现在就|赶紧|严重/u, /\burgent\b|\basap\b|\bnow\b/i])
    || boundary.requestReasonableness === 'excessive';

  let userMode = 'casual_chat';
  if (boundary.requestReasonableness === 'abusive') userMode = 'commanding';
  else if (frustrated || distressed) userMode = 'venting';
  else if (hasAny(text, [/改成|不是|不对|重写|调整方向/u, /\brevise\b|\bwrong\b|\bagain\b/i])) userMode = 'correcting_direction';
  else if (strongTask) userMode = 'requesting_task';
  else if (ideaOnly) userMode = 'sharing_idea';
  else if (weak) userMode = 'agreeing';
  else if (/\?$|？$/.test(text)) userMode = 'asking';

  const intentStrength = weak ? 'weak' : strongTask ? 'strong' : ideaOnly || userMode === 'asking' ? 'medium' : 'medium';
  const wantsDepth = hasAny(text, [/详细|完整|深入|架构|方案|拆解/u, /\bdeep\b|\bdetailed\b|\bfull\b/i]);
  const needsDirectAnswer = intentStrength === 'strong' || userMode === 'asking';
  const userEmotion = distressed ? 'distressed' : frustrated ? 'frustrated' : playful ? 'playful' : ideaOnly ? 'curious' : 'neutral';
  const userEnergy = distressed || /累|困|疲惫/u.test(text) ? 'low' : highPressure || playful ? 'high' : 'medium';

  return {
    intentStrength,
    userMode,
    taskType,
    wantsDepth,
    needsDirectAnswer,
    shouldAITakeLead: intentStrength === 'weak',
    userEnergy,
    userEmotion,
    taskPressure: highPressure ? 'high' : taskType === 'none' ? 'low' : 'medium',
    requestReasonableness: boundary.requestReasonableness,
    boundaryPressureDelta: boundary.boundaryPressureDelta,
    safetyRisk: boundary.requestReasonableness === 'unsafe',
    confidence: 0.72,
    currentTopic: taskType !== 'none' ? taskType : state.currentTopic || ''
  };
}

module.exports = {
  analyzeConversation,
  inferTaskType
};
