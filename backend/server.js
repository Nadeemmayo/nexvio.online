// Nexvio SEO Audit Tool — Backend
// Scans a Client website + Competitor website for Technical + On-Page SEO issues
// and produces a professional side-by-side comparison PDF report.

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;

// =========================================================
// STEP 1: Fetch a page's raw HTML (handles http or https)
// =========================================================
function fetchPage(targetUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const lib = parsed.protocol === 'http:' ? http : https;
    const start = Date.now();

    const req = lib.get(parsed, { timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          html: data,
          statusCode: res.statusCode,
          headers: res.headers,
          loadTimeMs: Date.now() - start,
          finalUrl: targetUrl,
          usedHttps: parsed.protocol === 'https:'
        });
      });
    });

    req.on('error', (err) => reject(new Error(`Could not reach ${targetUrl}: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`${targetUrl} took too long to respond`));
    });
  });
}

function fetchExtra(baseUrl, path) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(path, baseUrl);
    } catch (e) {
      return resolve({ exists: false });
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(parsed, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ exists: res.statusCode === 200, content: data }));
    });
    req.on('error', () => resolve({ exists: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ exists: false });
    });
  });
}

// =========================================================
// STEP 2: Run all Technical + On-Page SEO checks on one page
// =========================================================
async function auditWebsite(targetUrl) {
  const page = await fetchPage(targetUrl);
  const html = page.html;
  const issues = [];
  const passed = [];

  function addIssue(severity, category, message) {
    issues.push({ severity, category, message });
  }
  function addPass(category, message) {
    passed.push({ category, message });
  }

  // ---------- TECHNICAL SEO ----------
  if (page.usedHttps) {
    addPass('Technical', 'Site uses HTTPS (secure connection)');
  } else {
    addIssue('high', 'Technical', 'Site is not using HTTPS — this hurts trust and rankings');
  }

  if (page.statusCode >= 200 && page.statusCode < 300) {
    addPass('Technical', `Page returns a healthy status code (${page.statusCode})`);
  } else {
    addIssue('high', 'Technical', `Page returned status code ${page.statusCode}`);
  }

  if (page.loadTimeMs < 1000) {
    addPass('Technical', `Fast server response time (${page.loadTimeMs}ms)`);
  } else if (page.loadTimeMs < 2500) {
    addIssue('low', 'Technical', `Moderate server response time (${page.loadTimeMs}ms) — could be faster`);
  } else {
    addIssue('high', 'Technical', `Slow server response time (${page.loadTimeMs}ms) — this can hurt rankings and user experience`);
  }

  const robots = await fetchExtra(targetUrl, '/robots.txt');
  if (robots.exists) {
    addPass('Technical', 'robots.txt file found');
  } else {
    addIssue('medium', 'Technical', 'No robots.txt file found');
  }

  const sitemap = await fetchExtra(targetUrl, '/sitemap.xml');
  if (sitemap.exists) {
    addPass('Technical', 'sitemap.xml file found');
  } else {
    addIssue('medium', 'Technical', 'No sitemap.xml file found — this can slow down indexing by search engines');
  }

  if (/<meta[^>]+name=["']viewport["']/i.test(html)) {
    addPass('Technical', 'Viewport meta tag present (mobile-friendly signal)');
  } else {
    addIssue('high', 'Technical', 'Missing viewport meta tag — site may not be mobile-friendly');
  }

  if (/<link[^>]+rel=["']canonical["']/i.test(html)) {
    addPass('Technical', 'Canonical tag present');
  } else {
    addIssue('low', 'Technical', 'No canonical tag found — risk of duplicate content issues');
  }

  // ---------- ON-PAGE SEO ----------
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    const title = titleMatch[1].trim();
    addPass('On-Page', `Title tag present: "${title}" (${title.length} characters)`);
    if (title.length < 30) {
      addIssue('medium', 'On-Page', 'Title tag is shorter than recommended (under 30 characters)');
    } else if (title.length > 60) {
      addIssue('medium', 'On-Page', 'Title tag is longer than recommended (over 60 characters) — may get cut off in search results');
    }
  } else {
    addIssue('high', 'On-Page', 'Missing title tag');
  }

  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (metaDescMatch && metaDescMatch[1].trim()) {
    const desc = metaDescMatch[1].trim();
    addPass('On-Page', `Meta description present (${desc.length} characters)`);
    if (desc.length < 70) {
      addIssue('low', 'On-Page', 'Meta description is shorter than recommended (under 70 characters)');
    } else if (desc.length > 160) {
      addIssue('medium', 'On-Page', 'Meta description is longer than recommended (over 160 characters)');
    }
  } else {
    addIssue('high', 'On-Page', 'Missing meta description');
  }

  const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  if (h1Matches.length === 0) {
    addIssue('high', 'On-Page', 'No H1 heading found on the page');
  } else if (h1Matches.length > 1) {
    addIssue('medium', 'On-Page', `Multiple H1 tags found (${h1Matches.length}) — best practice is exactly one per page`);
  } else {
    addPass('On-Page', 'Exactly one H1 heading found (best practice)');
  }

  const h2Matches = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
  if (h2Matches.length === 0) {
    addIssue('low', 'On-Page', 'No H2 subheadings found — content structure could be improved');
  } else {
    addPass('On-Page', `${h2Matches.length} H2 subheading(s) found`);
  }

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const imgsMissingAlt = imgTags.filter((tag) => !/alt=["'][^"']*["']/i.test(tag) || /alt=["']\s*["']/i.test(tag));
  if (imgTags.length > 0) {
    if (imgsMissingAlt.length > 0) {
      addIssue('medium', 'On-Page', `${imgsMissingAlt.length} of ${imgTags.length} images are missing descriptive alt text`);
    } else {
      addPass('On-Page', `All ${imgTags.length} images have alt text`);
    }
  }

  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = visibleText.split(' ').filter(Boolean).length;
  if (wordCount < 300) {
    addIssue('medium', 'On-Page', `Low word count (${wordCount} words) — thin content can hurt rankings`);
  } else {
    addPass('On-Page', `Healthy word count (${wordCount} words)`);
  }

  const hrefMatches = html.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
  let internalLinks = 0;
  let externalLinks = 0;
  const domain = new URL(targetUrl).hostname;
  hrefMatches.forEach((tag) => {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) return;
    const href = hrefMatch[1];
    if (href.startsWith('http')) {
      try {
        const linkHost = new URL(href).hostname;
        if (linkHost === domain) internalLinks++;
        else externalLinks++;
      } catch (e) {}
    } else if (href.startsWith('/')) {
      internalLinks++;
    }
  });
  addPass('On-Page', `${internalLinks} internal link(s) and ${externalLinks} external link(s) found`);

  return {
    url: targetUrl,
    statusCode: page.statusCode,
    loadTimeMs: page.loadTimeMs,
    wordCount,
    issues,
    passed,
    summary: {
      highIssues: issues.filter((i) => i.severity === 'high').length,
      mediumIssues: issues.filter((i) => i.severity === 'medium').length,
      lowIssues: issues.filter((i) => i.severity === 'low').length,
      totalChecksPassed: passed.length
    }
  };
}

// =========================================================
// STEP 3: Build the PDF report
// =========================================================
function severityLabel(sev) {
  if (sev === 'high') return 'HIGH PRIORITY';
  if (sev === 'medium') return 'MEDIUM PRIORITY';
  return 'LOW PRIORITY';
}

function severityColor(sev) {
  if (sev === 'high') return '#D64545';
  if (sev === 'medium') return '#E0A030';
  return '#6B8FBF';
}

function buildPdfReport(clientResult, competitorResult, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const brandColor = '#1F3A5F';
  const grey = '#666666';

  // ---------- Cover ----------
  doc.fillColor(brandColor).fontSize(26).font('Helvetica-Bold').text('SEO Audit Report', { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor(grey).fontSize(11).font('Helvetica').text('Technical SEO & On-Page SEO Analysis', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor(grey).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'left' });
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#DDDDDD').stroke();
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#000').font('Helvetica-Bold').text('Client Website:', { continued: true }).font('Helvetica').text(`  ${clientResult.url}`);
  if (competitorResult) {
    doc.font('Helvetica-Bold').text('Competitor Website:', { continued: true }).font('Helvetica').text(`  ${competitorResult.url}`);
  }
  doc.moveDown(1);

  // ---------- Score summary ----------
  function drawScoreBox(label, result, x) {
    const boxWidth = competitorResult ? 230 : 480;
    doc.roundedRect(x, doc.y, boxWidth, 90, 6).fillAndStroke('#F5F7FA', '#E0E4E9');
    const boxTop = doc.y;
    doc.fillColor(brandColor).fontSize(11).font('Helvetica-Bold').text(label, x + 15, boxTop + 12);
    doc.fontSize(9).fillColor(grey).font('Helvetica').text(result.url, x + 15, boxTop + 28, { width: boxWidth - 30 });
    doc.fontSize(10).fillColor('#D64545').text(`High priority issues: ${result.summary.highIssues}`, x + 15, boxTop + 45);
    doc.fillColor('#E0A030').text(`Medium priority issues: ${result.summary.mediumIssues}`, x + 15, boxTop + 58);
    doc.fillColor('#6B8FBF').text(`Low priority issues: ${result.summary.lowIssues}`, x + 15, boxTop + 71);
  }

  const startY = doc.y;
  drawScoreBox('CLIENT', clientResult, 50);
  if (competitorResult) {
    doc.y = startY;
    drawScoreBox('COMPETITOR', competitorResult, 295);
  }
  doc.y = startY + 110;
  doc.moveDown(0.5);

  // ---------- Detailed issues per site ----------
  function renderSiteIssues(label, result) {
    if (doc.y > 680) doc.addPage();
    doc.moveDown(0.5);
    doc.fillColor(brandColor).fontSize(15).font('Helvetica-Bold').text(`${label} — Issues Found`);
    doc.moveDown(0.3);

    if (result.issues.length === 0) {
      doc.fontSize(10).fillColor('#2E7D32').font('Helvetica').text('No major issues found.');
    } else {
      result.issues.forEach((issue) => {
        if (doc.y > 740) doc.addPage();
        doc.fontSize(9).fillColor(severityColor(issue.severity)).font('Helvetica-Bold')
          .text(`[${severityLabel(issue.severity)}] `, { continued: true })
          .fillColor('#000').font('Helvetica').fontSize(10)
          .text(`(${issue.category}) ${issue.message}`);
        doc.moveDown(0.25);
      });
    }
    doc.moveDown(0.5);

    doc.fontSize(13).fillColor(brandColor).font('Helvetica-Bold').text(`${label} — Checks Passed`);
    doc.moveDown(0.2);
    result.passed.forEach((p) => {
      if (doc.y > 740) doc.addPage();
      doc.fontSize(10).fillColor('#2E7D32').font('Helvetica').text(`✓ (${p.category}) ${p.message}`);
      doc.moveDown(0.15);
    });
  }

  renderSiteIssues('Client', clientResult);
  if (competitorResult) {
    doc.addPage();
    renderSiteIssues('Competitor', competitorResult);
  }

  // ---------- Footer note ----------
  doc.addPage();
  doc.fillColor(brandColor).fontSize(14).font('Helvetica-Bold').text('Next Steps');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#000').font('Helvetica').text(
    'This report covers Technical SEO and On-Page SEO factors. Resolving the high-priority issues above is typically the fastest way to improve search visibility. For sustained ranking growth, this should be paired with an ongoing backlink and authority-building strategy.',
    { width: 495 }
  );
  doc.moveDown(1);
  doc.fontSize(9).fillColor(grey).text('Report generated by Nexvio — nexvio.online', { align: 'center' });

  doc.end();
}

// =========================================================
// API endpoint
// =========================================================
app.post('/api/audit', async (req, res) => {
  const { client_url, competitor_url } = req.body;

  if (!client_url) {
    return res.status(400).json({ error: 'client_url is required' });
  }

  try {
    const clientResult = await auditWebsite(client_url);
    let competitorResult = null;
    if (competitor_url) {
      competitorResult = await auditWebsite(competitor_url);
    }

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
const dns = require('dns').promises;

const disposableDomains = [
  'mailinator.com',
  '10minutemail.com',
  'tempmail.com',
  'guerrillamail.com',
  'yopmail.com'
];

const roleBasedPrefixes = [
  'admin',
  'info',
  'support',
  'sales',
  'contact',
  'hello',
  'team',
  'office'
];

app.post('/api/verify-emails', async (req, res) => {
  try {
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];

    if (!emails.length) {
      return res.status(400).json({ error: 'No emails provided' });
    }

    if (emails.length > 25) {
      return res.status(400).json({ error: 'Maximum 25 emails allowed per check' });
    }

    const results = await Promise.all(emails.map(async (email) => {
      email = String(email).trim().toLowerCase();

      const formatValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const domain = formatValid ? email.split('@')[1] : '';
      const local = formatValid ? email.split('@')[0] : '';

      let mxValid = false;
      let mxRecords = [];

      if (formatValid) {
        try {
          mxRecords = await dns.resolveMx(domain);
          mxValid = mxRecords && mxRecords.length > 0;
        } catch (e) {
          mxValid = false;
        }
      }

      const isDisposable = disposableDomains.includes(domain);
      const isRoleBased = roleBasedPrefixes.includes(local);

      let status = 'Invalid';

      if (formatValid && mxValid && !isDisposable) {
        status = 'Valid';
      } else if (formatValid && !mxValid) {
        status = 'Risky';
      }

      return {
        email,
        formatValid,
        domain,
        mxValid,
        isDisposable,
        isRoleBased,
        status
      };
    }));

    res.json({ total: results.length, results });
  } catch (err) {
    res.status(500).json({ error: 'Email verification failed' });
  }
});
app.listen(PORT, () => {
  console.log(`SEO Audit tool running on port ${PORT}`);
});
