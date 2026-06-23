const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const { URL } = require('url');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','10minutemail.com','tempmail.com','guerrillamail.com',
  'yopmail.com','throwaway.email','trashmail.com','fakeinbox.com',
  'sharklasers.com','dispostable.com'
]);

const ROLE_PREFIXES = new Set([
  'admin','info','support','sales','contact','hello','team',
  'office','help','no-reply','noreply','postmaster','webmaster'
]);

function strictFormatCheck(email) {
  if ((email.match(/@/g) || []).length !== 1) return false;
  const [local, domain] = email.split('@');
  if (!/^[a-zA-Z0-9._%+\-]+$/.test(local)) return false;
  if (local.includes('..') || local.startsWith('.') || local.endsWith('.')) return false;
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) return false;
  return true;
}

async function getMxRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return null;
    records.sort((a, b) => a.priority - b.priority);
    return records;
  } catch { return null; }
}

function smtpCheck(mxHost, email) {
  return new Promise((resolve) => {
    let stage = 0;
    let buffer = '';

    const socket = net.createConnection(25, mxHost);
    socket.setTimeout(8000);

    const done = (accepted, response) => {
      try { socket.write('QUIT\r\n'); socket.destroy(); } catch {}
      resolve({ connected: true, accepted, response });
    };

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3));
        if (stage === 0 && code === 220) { stage = 1; socket.write('EHLO nexvio.online\r\n'); }
        else if (stage === 1 && code === 250) { stage = 2; socket.write('MAIL FROM:<verify@nexvio.online>\r\n'); }
        else if (stage === 2 && code === 250) { stage = 3; socket.write(`RCPT TO:<${email}>\r\n`); }
        else if (stage === 3) {
          if (code === 250 || code === 251) done(true, line);
          else done(false, line);
        }
      }
    });

    socket.on('connect', () => {});
    socket.on('timeout', () => { socket.destroy(); resolve({ connected: false, accepted: false, response: 'timeout' }); });
    socket.on('error', (err) => resolve({ connected: false, accepted: false, response: err.message }));
  });
}

async function verifyEmail(email) {
  email = String(email).trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  const local = email.includes('@') ? email.split('@')[0] : '';

  if (!strictFormatCheck(email)) {
    return { email, format: 'invalid', mx: 'invalid', smtp: 'invalid', status: 'Invalid', reason: 'Invalid email format' };
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email, format: 'valid', mx: 'unknown', smtp: 'invalid', status: 'Invalid', reason: 'Disposable email domain' };
  }

  const mxRecords = await getMxRecords(domain);
  if (!mxRecords) {
    return { email, format: 'valid', mx: 'invalid', smtp: 'invalid', status: 'Invalid', reason: 'No MX records found' };
  }

  const isRoleBased = ROLE_PREFIXES.has(local);
  const mxHost = mxRecords[0].exchange;
  const smtp = await smtpCheck(mxHost, email);

  let status, reason;
  if (!smtp.connected) {
    status = 'Unknown';
    reason = 'SMTP server did not respond';
  } else if (smtp.accepted) {
    status = 'Valid';
    reason = isRoleBased ? 'Valid - role-based address' : 'Mailbox exists';
  } else {
    status = 'Invalid';
    reason = 'Mailbox does not exist';
  }

  return { email, format: 'valid', mx: 'valid', smtp: smtp.connected ? (smtp.accepted ? 'valid' : 'invalid') : 'unknown', status, reason, isRoleBased, mxHost };
}

app.post('/api/verify-emails', async (req, res) => {
  try {
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];
    if (!emails.length) return res.status(400).json({ error: 'No emails provided' });
    if (emails.length > 25) return res.status(400).json({ error: 'Maximum 25 emails allowed' });
    const unique = [...new Set(emails.map(e => String(e).trim().toLowerCase()).filter(Boolean))];
    const results = await Promise.all(unique.map(email => verifyEmail(email)));
    res.json({
      total: results.length,
      valid: results.filter(r => r.status === 'Valid').length,
      invalid: results.filter(r => r.status === 'Invalid').length,
      unknown: results.filter(r => r.status === 'Unknown').length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

function fetchPage(targetUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(new Error(`Invalid URL: ${targetUrl}`)); }
    const lib = parsed.protocol === 'http:' ? http : https;
    const start = Date.now();
    const req = lib.get(parsed, { timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ html: data, statusCode: res.statusCode, headers: res.headers, loadTimeMs: Date.now() - start, finalUrl: targetUrl, usedHttps: parsed.protocol === 'https:' }));
    });
    req.on('error', (err) => reject(new Error(`Could not reach ${targetUrl}: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`${targetUrl} took too long to respond`)); });
  });
}

function fetchExtra(baseUrl, path) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(path, baseUrl); } catch (e) { return resolve({ exists: false }); }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(parsed, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ exists: res.statusCode === 200, content: data }));
    });
    req.on('error', () => resolve({ exists: false }));
    req.on('timeout', () => { req.destroy(); resolve({ exists: false })); });
  });
}

async function auditWebsite(targetUrl) {
  const page = await fetchPage(targetUrl);
  const html = page.html;
  const issues = [];
  const passed = [];

  function addIssue(severity, category, message) { issues.push({ severity, category, message }); }
  function addPass(category, message) { passed.push({ category, message }); }

  if (page.usedHttps) addPass('Technical', 'Site uses HTTPS');
  else addIssue('high', 'Technical', 'Site is not using HTTPS');

  if (page.statusCode >= 200 && page.statusCode < 300) addPass('Technical', `Healthy status code (${page.statusCode})`);
  else addIssue('high', 'Technical', `Page returned status code ${page.statusCode}`);

  if (page.loadTimeMs < 1000) addPass('Technical', `Fast response time (${page.loadTimeMs}ms)`);
  else if (page.loadTimeMs < 2500) addIssue('low', 'Technical', `Moderate response time (${page.loadTimeMs}ms)`);
  else addIssue('high', 'Technical', `Slow response time (${page.loadTimeMs}ms)`);

  const robots = await fetchExtra(targetUrl, '/robots.txt');
  if (robots.exists) addPass('Technical', 'robots.txt found');
  else addIssue('medium', 'Technical', 'No robots.txt found');

  const sitemap = await fetchExtra(targetUrl, '/sitemap.xml');
  if (sitemap.exists) addPass('Technical', 'sitemap.xml found');
  else addIssue('medium', 'Technical', 'No sitemap.xml found');

  if (/<meta[^>]+name=["']viewport["']/i.test(html)) addPass('Technical', 'Viewport meta tag present');
  else addIssue('high', 'Technical', 'Missing viewport meta tag');

  if (/<link[^>]+rel=["']canonical["']/i.test(html)) addPass('Technical', 'Canonical tag present');
  else addIssue('low', 'Technical', 'No canonical tag found');

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    const title = titleMatch[1].trim();
    addPass('On-Page', `Title: "${title}" (${title.length} chars)`);
    if (title.length < 30) addIssue('medium', 'On-Page', 'Title too short (under 30 chars)');
    else if (title.length > 60) addIssue('medium', 'On-Page', 'Title too long (over 60 chars)');
  } else addIssue('high', 'On-Page', 'Missing title tag');

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (metaDescMatch && metaDescMatch[1].trim()) {
    const desc = metaDescMatch[1].trim();
    addPass('On-Page', `Meta description (${desc.length} chars)`);
    if (desc.length < 70) addIssue('low', 'On-Page', 'Meta description too short');
    else if (desc.length > 160) addIssue('medium', 'On-Page', 'Meta description too long');
  } else addIssue('high', 'On-Page', 'Missing meta description');

  const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  if (h1Matches.length === 0) addIssue('high', 'On-Page', 'No H1 heading found');
  else if (h1Matches.length > 1) addIssue('medium', 'On-Page', `Multiple H1 tags (${h1Matches.length})`);
  else addPass('On-Page', 'Exactly one H1 heading found');

  const h2Matches = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
  if (h2Matches.length === 0) addIssue('low', 'On-Page', 'No H2 subheadings found');
  else addPass('On-Page', `${h2Matches.length} H2 subheading(s) found`);

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const imgsMissingAlt = imgTags.filter(tag => !/alt=["'][^"']*["']/i.test(tag) || /alt=["']\s*["']/i.test(tag));
  if (imgTags.length > 0) {
    if (imgsMissingAlt.length > 0) addIssue('medium', 'On-Page', `${imgsMissingAlt.length} of ${imgTags.length} images missing alt text`);
    else addPass('On-Page', `All ${imgTags.length} images have alt text`);
  }

  const visibleText = html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const wordCount = visibleText.split(' ').filter(Boolean).length;
  if (wordCount < 300) addIssue('medium', 'On-Page', `Low word count (${wordCount} words)`);
  else addPass('On-Page', `Healthy word count (${wordCount} words)`);

  const hrefMatches = html.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
  let internalLinks = 0, externalLinks = 0;
  const domain = new URL(targetUrl).hostname;
  hrefMatches.forEach(tag => {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) return;
    const href = hrefMatch[1];
    if (href.startsWith('http')) {
      try { const linkHost = new URL(href).hostname; if (linkHost === domain) internalLinks++; else externalLinks++; } catch {}
    } else if (href.startsWith('/')) internalLinks++;
  });
  addPass('On-Page', `${internalLinks} internal and ${externalLinks} external links`);

  return { url: targetUrl, statusCode: page.statusCode, loadTimeMs: page.loadTimeMs, wordCount, issues, passed, summary: { highIssues: issues.filter(i => i.severity==='high').length, mediumIssues: issues.filter(i => i.severity==='medium').length, lowIssues: issues.filter(i => i.severity==='low').length, totalChecksPassed: passed.length } };
}

function severityLabel(sev) { if (sev==='high') return 'HIGH PRIORITY'; if (sev==='medium') return 'MEDIUM PRIORITY'; return 'LOW PRIORITY'; }
function severityColor(sev) { if (sev==='high') return '#D64545'; if (sev==='medium') return '#E0A030'; return '#6B8FBF'; }

function buildPdfReport(clientResult, competitorResult, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);
  const brandColor = '#1F3A5F';
  const grey = '#666666';

  doc.fillColor(brandColor).fontSize(26).font('Helvetica-Bold').text('SEO Audit Report', { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor(grey).fontSize(11).font('Helvetica').text('Technical SEO & On-Page SEO Analysis');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor(grey).text(`Generated on ${new Date().toLocaleDateString()}`);
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#DDDDDD').stroke();
  doc.moveDown(1);
  doc.fontSize(12).fillColor('#000').font('Helvetica-Bold').text('Client Website:', { continued: true }).font('Helvetica').text(`  ${clientResult.url}`);
  if (competitorResult) doc.font('Helvetica-Bold').text('Competitor Website:', { continued: true }).font('Helvetica').text(`  ${competitorResult.url}`);
  doc.moveDown(1);

  function drawScoreBox(label, result, x) {
    const boxWidth = competitorResult ? 230 : 480;
    doc.roundedRect(x, doc.y, boxWidth, 90, 6).fillAndStroke('#F5F7FA', '#E0E4E9');
    const boxTop = doc.y;
    doc.fillColor(brandColor).fontSize(11).font('Helvetica-Bold').text(label, x+15, boxTop+12);
    doc.fontSize(9).fillColor(grey).font('Helvetica').text(result.url, x+15, boxTop+28, { width: boxWidth-30 });
    doc.fontSize(10).fillColor('#D64545').text(`High priority issues: ${result.summary.highIssues}`, x+15, boxTop+45);
    doc.fillColor('#E0A030').text(`Medium priority issues: ${result.summary.mediumIssues}`, x+15, boxTop+58);
    doc.fillColor('#6B8FBF').text(`Low priority issues: ${result.summary.lowIssues}`, x+15, boxTop+71);
  }

  const startY = doc.y;
  drawScoreBox('CLIENT', clientResult, 50);
  if (competitorResult) { doc.y = startY; drawScoreBox('COMPETITOR', competitorResult, 295); }
  doc.y = startY + 110;
  doc.moveDown(0.5);

  function renderSiteIssues(label, result) {
    if (doc.y > 680) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(brandColor).fontSize(15).font('Helvetica-Bold').text(`${label} — Issues Found`);
    doc.moveDown(0.3);
    if (result.issues.length === 0) { doc.fontSize(10).fillColor('#2E7D32').font('Helvetica').text('No major issues found.'); }
    else {
      result.issues.forEach(issue => {
        if (doc.y > 740) doc.addPage();
        doc.fontSize(9).fillColor(severityColor(issue.severity)).font('Helvetica-Bold').text(`[${severityLabel(issue.severity)}] `, { continued: true }).fillColor('#000').font('Helvetica').fontSize(10).text(`(${issue.category}) ${issue.message}`);
        doc.moveDown(0.25);
      });
    }
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor(brandColor).font('Helvetica-Bold').text(`${label} — Checks Passed`);
    doc.moveDown(0.2);
    result.passed.forEach(p => {
      if (doc.y > 740) doc.addPage();
      doc.fontSize(10).fillColor('#2E7D32').font('Helvetica').text(`✓ (${p.category}) ${p.message}`);
      doc.moveDown(0.15);
    });
  }

  renderSiteIssues('Client', clientResult);
  if (competitorResult) { doc.addPage(); renderSiteIssues('Competitor', competitorResult); }

  doc.addPage();
  doc.fillColor(brandColor).fontSize(14).font('Helvetica-Bold').text('Next Steps');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#000').font('Helvetica').text('This report covers Technical SEO and On-Page SEO factors. Resolving the high-priority issues above is typically the fastest way to improve search visibility. For sustained ranking growth, this should be paired with an ongoing backlink and authority-building strategy.', { width: 495 });
  doc.moveDown(1);
  doc.fontSize(9).fillColor(grey).text('Report generated by Nexvio — nexvio.online', { align: 'center' });
  doc.end();
}

app.post('/api/audit', async (req, res) => {
  const { client_url, competitor_url } = req.body;
  if (!client_url) return res.status(400).json({ error: 'client_url is required' });
  try {
    const clientResult = await auditWebsite(client_url);
    let competitorResult = null;
    if (competitor_url) competitorResult = await auditWebsite(competitor_url);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="seo-audit-report.pdf"');
    buildPdfReport(clientResult, competitorResult, res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Audit failed' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`SEO Audit tool running on port ${PORT}`);
});
