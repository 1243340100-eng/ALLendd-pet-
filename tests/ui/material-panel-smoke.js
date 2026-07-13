const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();

async function run() {
  const win = new BrowserWindow({
    width: 360,
    height: 560,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', '..', 'app', 'index.html'));

  const result = await win.webContents.executeJavaScript(`(async () => {
    const state = document.getElementById('statePanel');
    const panel = document.getElementById('materialPanel');
    const open = document.getElementById('materialLibraryBtn');
    const plus = document.getElementById('importMaterialBtn');
    const reset = document.getElementById('resetUserDataBtn');
    if (!state || !panel || !open || !plus || !reset) throw new Error('material UI contract is incomplete');
    state.classList.remove('hidden');
    open.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 此独立页面不会走 main.js 的透明空间扩展；为视觉截图模拟扩展后的可见区域。
    panel.style.top = '16px';
    panel.style.bottom = 'auto';
    panel.style.maxHeight = '520px';
    await new Promise((resolve) => setTimeout(resolve, 260));
    return {
      stateHidden: state.classList.contains('hidden'),
      materialVisible: !panel.classList.contains('hidden'),
      panelRect: (() => {
        const rect = panel.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })(),
      panelOpacity: getComputedStyle(panel).opacity,
      panelVisibility: getComputedStyle(panel).visibility,
      plusWidth: plus.getBoundingClientRect().width,
      plusHeight: plus.getBoundingClientRect().height,
      resetIsLast: reset.parentElement.lastElementChild === reset
    };
  })()`);

  if (!result.stateHidden || !result.materialVisible || result.plusWidth <= 0 || result.plusHeight <= 0 || !result.resetIsLast) {
    throw new Error(`material panel smoke failed: ${JSON.stringify(result)}`);
  }
  const screenshot = path.join(os.tmpdir(), 'pet-framework-material-panel.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log('PASS material panel smoke', JSON.stringify(result));
  console.log(`SCREENSHOT=${screenshot}`);
  await win.close();
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error.stack || error.message || error);
  app.exit(1);
});
