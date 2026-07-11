const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..', '..');
const mainSource = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(appRoot, 'renderer.js'), 'utf8');

assert.strictEqual(mainSource.includes('buildMemoryConfirmation'), false);
assert.strictEqual(rendererSource.includes('if (memoryAnalysis.remembered)'), false);
assert.strictEqual(rendererSource.includes('longTermMemorySaved'), false);
assert.strictEqual(rendererSource.includes('userMemorySaved'), false);
assert.strictEqual(rendererSource.includes("memoryAnalysis.ok === false"), false,
  'renderer must not block chat when memory analysis fails');
const analysisIndex = rendererSource.indexOf('analyzeAndApplyMemory?.(message)');
const chatIndex = rendererSource.indexOf('window.petAPI?.sendChat?.({', analysisIndex);
assert.ok(analysisIndex >= 0);
assert.ok(chatIndex > analysisIndex);

const pushUserBeforeAnalysis = rendererSource.indexOf("pushChat('user', message)");
assert.ok(pushUserBeforeAnalysis >= 0 && pushUserBeforeAnalysis < analysisIndex,
  'user message must be displayed before memory analysis');

console.log('PASS framework memory writes continue through the character chat reply');
