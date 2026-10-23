const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CDP_PORT = 9347;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ method, hostname: '127.0.0.1', port, path: urlPath }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.next = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
  }
  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(detail || JSON.stringify(result.exceptionDetails).slice(0, 800));
    }
    return result.result.value;
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rel = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('no');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitForChrome() {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await request(CDP_PORT, 'GET', '/json/version');
      if (res.status === 200) return JSON.parse(res.body);
    } catch (err) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Chrome did not open a debugging port');
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const chrome = spawn('/usr/bin/google-chrome-stable', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=/tmp/chrome-phone-layout-ae66'
  ], { stdio: 'ignore' });
  let page;
  try {
    await waitForChrome();
    const created = await request(CDP_PORT, 'PUT', '/json/new?about:blank');
    const target = JSON.parse(created.body);
    page = new CDP(target.webSocketDebuggerUrl);
    await page.open();
    await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await page.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/cost-of-living/' });
    const ready = await page.eval(`new Promise(resolve => {
      const start = Date.now();
      const timer = setInterval(() => {
        const zip = document.getElementById('zip');
        if (typeof factors !== 'undefined' && factors && typeof bundle !== 'undefined' && bundle && zip) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start > 8000) {
          clearInterval(timer);
          resolve(false);
        }
      }, 40);
    })`);
    if (!ready) throw new Error('cost of living page did not finish loading');
    const field = await page.eval(`(() => {
      const el = document.getElementById('zip');
      const style = getComputedStyle(el);
      return {
        disabled: !!el.disabled,
        pointer: style.pointerEvents,
        font: parseFloat(style.fontSize),
        color: style.color,
        background: style.backgroundColor
      };
    })()`);
    if (field.disabled || field.pointer === 'none' || !(field.font >= 16)) {
      throw new Error('zip field is not usable at 390px: ' + JSON.stringify(field));
    }
    if (field.color !== 'rgb(0, 27, 53)' || field.background !== 'rgb(247, 244, 236)') {
      throw new Error('zip field colors: ' + JSON.stringify(field));
    }
    const layout = await page.eval(`(async () => {
      Object.assign(A, {
        zip: '43215', to: 'sarasota', household: '2', adults: '2', income: '75to150',
        ownNow: 'own', planFL: 'buy', primary: 'yes', drives: 'yes', vehicles: '1',
        miles: '1000', fuel: 'gas', mpg: '25'
      });
      A.picks = { to: 3, household: 1, adults: 1, income: 2, ownNow: 0, planFL: 0, primary: 0, drives: 0, fuel: 0 };
      durations = [4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000];
      flowStart = Date.now() - 40000;
      await loadZipShard('43215');
      drawResults();
      const table = document.getElementById('compareTable');
      const cards = document.getElementById('compareCards');
      const compare = table && table.querySelector('table.compare');
      const tableStyle = table ? getComputedStyle(table) : null;
      const cardsStyle = cards ? getComputedStyle(cards) : null;
      const doc = document.documentElement;
      const rect = compare ? compare.getBoundingClientRect() : null;
      const amount = document.querySelector('.totalAmount');
      const amountStyle = amount ? getComputedStyle(amount) : null;
      return {
        tableHidden: !table || table.hidden || (tableStyle && tableStyle.display === 'none'),
        display: compare ? getComputedStyle(compare).display : '',
        cardsHidden: !cards || cards.hidden || (cardsStyle && cardsStyle.display === 'none'),
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        bodyScroll: document.body.scrollWidth,
        bodyClient: document.body.clientWidth,
        innerWidth: window.innerWidth,
        tableWidth: rect ? rect.width : 0,
        amount: amount ? amount.textContent : '',
        amountFont: amountStyle ? amountStyle.fontFamily : '',
        amountColor: amountStyle ? amountStyle.color : '',
        pageBg: getComputedStyle(document.body).backgroundColor
      };
    })()`);
    const failures = [];
    if (layout.tableHidden || layout.display !== 'table') failures.push('results did not stay a table: ' + JSON.stringify(layout));
    if (!layout.cardsHidden) failures.push('stacked cards are showing');
    if (layout.scrollWidth > layout.clientWidth + 1 || layout.bodyScroll > layout.bodyClient + 1) failures.push('horizontal scroll: ' + JSON.stringify(layout));
    if (layout.innerWidth !== 390) failures.push('viewport is ' + layout.innerWidth);
    if (!(layout.tableWidth > 0) || layout.tableWidth > layout.innerWidth + 1) failures.push('table does not fit the phone: ' + JSON.stringify(layout));
    if (layout.pageBg !== 'rgb(0, 27, 53)') failures.push('page background ' + layout.pageBg);
    if (!layout.amount || layout.amountFont.indexOf('Gelasio') < 0 || layout.amountColor !== 'rgb(212, 175, 55)') {
      failures.push('total is not large gold Gelasio: ' + JSON.stringify(layout));
    }
    if (failures.length) throw new Error(failures.join('; '));
    console.log('Phone layout at 390px keeps the comparison table and does not scroll sideways. Total ' + layout.amount + '.');
  } finally {
    if (page) page.ws.close();
    chrome.kill();
    server.close();
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
