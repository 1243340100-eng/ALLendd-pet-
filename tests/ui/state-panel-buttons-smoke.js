const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();

async function capture(win, fileName) {
  const image = await win.webContents.capturePage();
  const target = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(target, image.toPNG());
  return target;
}

async function run() {
  const win = new BrowserWindow({
    width: 300,
    height: 360,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#eee8d8',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', '..', 'app', 'index.html'));

  const metrics = await win.webContents.executeJavaScript(`(() => {
    try {
      const applyScale = (s) => {
        document.documentElement.style.setProperty('--scale', String(s));
        document.documentElement.classList.toggle('scale-small', s < 0.85);
      };
      applyScale(0.7);

      const panel = document.getElementById('statePanel');
      panel.classList.remove('hidden');

      const getStyle = (id) => {
        const btn = document.getElementById(id);
        if (!btn) throw new Error('button not found: ' + id);
        const textSpan = btn.querySelector('span:not(.icon)');
        const iconSpan = btn.querySelector('span.icon');
        if (!textSpan) throw new Error('text span not found in ' + id);
        if (!iconSpan) throw new Error('icon span not found in ' + id);
        return {
          id,
          textDisplay: window.getComputedStyle(textSpan).display,
          iconDisplay: window.getComputedStyle(iconSpan).display,
          buttonWidth: btn.getBoundingClientRect().width,
          buttonHeight: btn.getBoundingClientRect().height
        };
      };

      return {
        error: null,
        vw: innerWidth,
        vh: innerHeight,
        scale: getComputedStyle(document.documentElement).getPropertyValue('--scale'),
        hasScaleSmall: document.documentElement.classList.contains('scale-small'),
        buttons: [
          getStyle('refreshReminders'),
          getStyle('triggerDailyDigest'),
          getStyle('triggerReminderCheck'),
          getStyle('clearUserMemory'),
          getStyle('clearLongTermMemory'),
          getStyle('clearShortTermMemory'),
          getStyle('clearExpiredShortTerm'),
          getStyle('exportMemory'),
          getStyle('clearAllMemory')
        ]
      };
    } catch (e) {
      return { error: e.message + '\\n' + e.stack };
    }
  })()`);

  console.log('STATE_PANEL_METRICS=' + JSON.stringify(metrics, null, 2));

  const expectedHidden = ['triggerDailyDigest', 'triggerReminderCheck', 'exportMemory', 'clearAllMemory'];
  let allPassed = true;
  for (const btn of metrics.buttons) {
    if (metrics.hasScaleSmall && btn.textDisplay !== 'none') {
      console.error(`FAIL: ${btn.id} text should be hidden at scale 0.7, got display=${btn.textDisplay}`);
      allPassed = false;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  const screenshot = await capture(win, 'pet-framework-state-panel-small.png');

  if (allPassed) {
    console.log('PASS state panel buttons smoke');
  } else {
    console.log('FAIL state panel buttons smoke');
  }
  console.log(`SCREENSHOT=${screenshot}`);
  await win.close();
  process.exit(allPassed ? 0 : 1);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error.stack || error.message || error);
  app.exit(1);
});
