const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function capture(win, fileName) {
  const image = await win.webContents.capturePage();
  const target = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(target, image.toPNG());
  return target;
}

async function run() {
  const win = new BrowserWindow({
    width: 640,
    height: 820,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#eee8d8',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', '..', 'app', 'index.html'));

  const bubbleMetrics = await win.webContents.executeJavaScript(`(() => {
    document.documentElement.style.setProperty('--scale', '1.18');
    const stack = document.getElementById('reminderStack');
    for (let i = 0; i < 3; i++) {
      const item = document.createElement('div');
      item.className = 'reminder-bubble';
      item.textContent = '提醒 ' + (i + 1) + '：这是一条用于检查长文本换行和边界裁切的提醒内容。';
      stack.appendChild(item);
    }
    const plan = document.getElementById('planningBubble');
    plan.classList.remove('hidden');
    const timeline = document.getElementById('planBubbleTimeline');
    timeline.innerHTML = Array.from({length: 8}, (_, i) =>
      '<label class="plan-bubble__task"><span class="plan-bubble__task-time">' +
      String(9 + i).padStart(2, '0') + ':00</span><span class="plan-bubble__task-main">' +
      '<input type="checkbox" class="plan-bubble__task-checkbox"><span class="plan-bubble__task-text">计划任务 ' +
      (i + 1) + '，检查计划条不会被截断</span></span></label>'
    ).join('');
    const rect = (el) => { const r = el.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
    const pet = rect(document.getElementById('pet'));
    const stackRect = rect(stack);
    const planRect = rect(plan);
    return { vw: innerWidth, vh: innerHeight, pet, stackRect, planRect };
  })()`);

  console.log('BUBBLE_METRICS=' + JSON.stringify(bubbleMetrics));
  assert(bubbleMetrics.stackRect.left >= 0, 'reminder stack is clipped on the left');
  assert(bubbleMetrics.stackRect.right <= bubbleMetrics.vw, 'reminder stack is clipped on the right');
  assert(bubbleMetrics.planRect.left >= 0, 'planning bubble is clipped on the left');
  assert(bubbleMetrics.planRect.right <= bubbleMetrics.vw, 'planning bubble is clipped on the right');
  assert(bubbleMetrics.planRect.height >= 120, 'planning bubble was compressed by reminder bubbles');
  const baseWidth = 300 * 1.18;
  const transparentWidthExtra = bubbleMetrics.vw - baseWidth;
  const petScreenCenterRelativeToBase = (bubbleMetrics.pet.left + bubbleMetrics.pet.width / 2) - transparentWidthExtra;
  assert(Math.abs(petScreenCenterRelativeToBase - baseWidth / 2) <= 1,
    'pet screen anchor changed when reminder space expanded');
  await new Promise((resolve) => setTimeout(resolve, 350));
  const bubbleShot = await capture(win, 'pet-framework-layout-bubbles.png');

  const planningMetrics = await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.reminder-bubble').forEach((el) => el.classList.add('hidden'));
    const panel = document.getElementById('chatPanel');
    panel.classList.remove('hidden');
    panel.classList.add('chat-panel--planning');
    document.getElementById('chatLog').classList.add('hidden');
    document.getElementById('planningView').classList.remove('hidden');
    document.getElementById('planningDraft').classList.remove('hidden');
    document.getElementById('planningActions').classList.remove('hidden');
    const tasks = document.getElementById('planningDraftTasks');
    tasks.innerHTML = Array.from({length: 10}, (_, i) =>
      '<div class="planning-draft__task"><div class="planning-draft__task-head">' +
      '<span class="planning-draft__task-times">' + String(8 + i).padStart(2, '0') + ':00 - ' +
      String(9 + i).padStart(2, '0') + ':00</span></div><div class="planning-draft__task-content">草案任务 ' +
      (i + 1) + '，用于验证滚动列表</div></div>'
    ).join('');
    const rect = (el) => { const r = el.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
    const panelRect = rect(panel);
    const inputRect = rect(document.getElementById('chatInput'));
    const taskRect = rect(tasks);
    const actionsRect = rect(document.getElementById('planningActions'));
    return { vw: innerWidth, vh: innerHeight, panelRect, inputRect, taskRect, actionsRect };
  })()`);

  console.log('PLANNING_METRICS=' + JSON.stringify(planningMetrics));
  assert(planningMetrics.panelRect.left >= 0 && planningMetrics.panelRect.right <= planningMetrics.vw,
    'planning panel is horizontally clipped');
  assert(planningMetrics.panelRect.top >= 0 && planningMetrics.panelRect.bottom <= planningMetrics.vh,
    'planning panel is vertically clipped');
  assert(planningMetrics.inputRect.height > 0 && planningMetrics.inputRect.bottom <= planningMetrics.vh,
    'planning input is not visible');
  assert(planningMetrics.taskRect.height >= 100, 'planning task list collapsed');
  assert(planningMetrics.actionsRect.height > 0, 'planning actions are not visible');
  await new Promise((resolve) => setTimeout(resolve, 350));
  const planningShot = await capture(win, 'pet-framework-layout-planning.png');

  console.log('PASS layout visual smoke');
  console.log(`BUBBLE_SCREENSHOT=${bubbleShot}`);
  console.log(`PLANNING_SCREENSHOT=${planningShot}`);
  await win.close();
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error.stack || error.message || error);
  app.exit(1);
});
