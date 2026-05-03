// ============================================================
//  campro — Backend Server
//  Express + Agora Token Server + Firebase Admin + REST API
// ============================================================
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Agora Token Builder ──────────────────────────────────────
const { RtcTokenBuilder, RtcRole } = require('agora-token');

// ── Firebase Admin ───────────────────────────────────────────
const admin = require('firebase-admin');

let firestoreDb = null;

function initFirebaseAdmin() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('[Firebase Admin] No FIREBASE_SERVICE_ACCOUNT env – Firestore disabled.');
    return;
  }
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential:  admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    firestoreDb = admin.firestore();
    console.log('[Firebase Admin] ✅ Firestore connected');
  } catch (err) {
    console.error('[Firebase Admin] Init failed:', err.message);
  }
}
initFirebaseAdmin();

// ── Helper ───────────────────────────────────────────────────
function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env variable: ${name}`);
  return process.env[name];
}

// ============================================================
//  ROUTES
// ============================================================

// ── Health ───────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    firestore: !!firestoreDb,
    agora:     !!(process.env.AGORA_APP_ID),
  });
});

// ── Config (public keys only) ────────────────────────────────
// The frontend fetches this once on load so no secrets are in the HTML.
app.get('/api/config', (_req, res) => {
  res.json({
    agoraAppId: process.env.AGORA_APP_ID || '',
    firebase: {
      apiKey:            process.env.FIREBASE_API_KEY,
      authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
      databaseURL:       process.env.FIREBASE_DATABASE_URL,
      projectId:         process.env.FIREBASE_PROJECT_ID,
      storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.FIREBASE_APP_ID,
    },
  });
});

// ── Agora RTC Token ───────────────────────────────────────────
// GET /api/token?channel=ROOM-ID&uid=0&role=publisher
app.get('/api/token', (req, res) => {
  const { channel, uid = 0, role: agoraRole = 'publisher' } = req.query;

  if (!channel) {
    return res.status(400).json({ error: 'channel query param is required' });
  }

  const appId      = process.env.AGORA_APP_ID;
  const appCert    = process.env.AGORA_APP_CERTIFICATE;

  if (!appId) {
    return res.status(500).json({ error: 'AGORA_APP_ID not configured' });
  }

  // No certificate → no-auth mode (OK for development)
  if (!appCert) {
    console.warn('[Agora] No App Certificate — returning null token (dev mode)');
    return res.json({ token: null, appId, uid: Number(uid) });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const rtcRole   = agoraRole === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId, appCert, channel, Number(uid), rtcRole, expiresAt
  );

  res.json({ token, appId, uid: Number(uid), expiresAt });
});

// ── Sessions ──────────────────────────────────────────────────
// POST /api/sessions  — create / upsert a session record
app.post('/api/sessions', async (req, res) => {
  const { meetingId, interviewerName, candidateName, role } = req.body;

  if (!meetingId) return res.status(400).json({ error: 'meetingId required' });

  const data = {
    meetingId,
    interviewerName: interviewerName || '',
    candidateName:   candidateName   || '',
    role:            role            || '',
    status:          'active',
    startedAt:       new Date().toISOString(),
  };

  try {
    if (firestoreDb) {
      await firestoreDb
        .collection('sessions')
        .doc(meetingId.replace(/[^a-zA-Z0-9_-]/g, '_'))
        .set({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    res.json({ success: true, session: data });
  } catch (err) {
    console.error('[Sessions] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/sessions/:meetingId
app.get('/api/sessions/:meetingId', async (req, res) => {
  const safeId = req.params.meetingId.replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    if (!firestoreDb) return res.json({ session: null });
    const doc = await firestoreDb.collection('sessions').doc(safeId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });
    res.json({ session: doc.data() });
  } catch (err) {
    console.error('[Sessions] Get error:', err.message);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// ── Reports ───────────────────────────────────────────────────
// POST /api/reports  — save final interview report to Firestore
app.post('/api/reports', async (req, res) => {
  const { meetingId, report } = req.body;

  if (!meetingId || !report) {
    return res.status(400).json({ error: 'meetingId and report are required' });
  }

  const doc = {
    meetingId,
    savedAt:     new Date().toISOString(),
    trustScore:  report.trustScore  || 0,
    verdict:     report.verdict     || 'UNKNOWN',
    duration:    report.duration    || '00:00',
    alertCount:  report.alertCount  || 0,
    highCount:   report.highCount   || 0,
    counts:      report.counts      || {},
    alerts:      report.alerts      || [],
    interviewerName: report.interviewerName || '',
    candidateName:   report.candidateName   || '',
  };

  try {
    if (firestoreDb) {
      const ref = await firestoreDb.collection('reports').add({
        ...doc,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Mark the session as ended
      await firestoreDb
        .collection('sessions')
        .doc(meetingId.replace(/[^a-zA-Z0-9_-]/g, '_'))
        .set({ status: 'ended', endedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

      return res.json({ success: true, reportId: ref.id, report: doc });
    }
    // Firestore not configured — still return success so frontend isn't blocked
    res.json({ success: true, reportId: null, report: doc });
  } catch (err) {
    console.error('[Reports] Save error:', err.message);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// GET /api/reports/:meetingId  — fetch all reports for a session
app.get('/api/reports/:meetingId', async (req, res) => {
  if (!firestoreDb) return res.json({ reports: [] });

  try {
    const snap = await firestoreDb
      .collection('reports')
      .where('meetingId', '==', req.params.meetingId)
      .orderBy('savedAt', 'desc')
      .limit(20)
      .get();

    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ reports });
  } catch (err) {
    console.error('[Reports] Get error:', err.message);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

// GET /api/reports  — list all recent reports (admin/dashboard use)
app.get('/api/reports', async (req, res) => {
  if (!firestoreDb) return res.json({ reports: [] });

  try {
    const snap = await firestoreDb
      .collection('reports')
      .orderBy('savedAt', 'desc')
      .limit(50)
      .get();

    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ reports });
  } catch (err) {
    console.error('[Reports] List error:', err.message);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});


// ── Google Gemini AI ──────────────────────────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');

let geminiModel = null;
function getGemini() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!geminiModel) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Try newer model names supported by this SDK version
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
  }
  return geminiModel;
}

// ── Gemini: Generate interview questions ──────────────────────
// POST /api/gemini/questions  { role, level, count }
app.post('/api/gemini/questions', async (req, res) => {
  const { role = 'Software Engineer', level = 'Mid', count = 5 } = req.body;
  const model = getGemini();
  if (!model) return res.status(503).json({ error: 'Gemini API key not configured' });

  const prompt = `You are an expert technical interviewer. Generate ${count} interview questions for a ${level}-level ${role} position.

Rules:
- Mix behavioral, technical, and situational questions
- Make them specific and thought-provoking
- Each question should reveal something meaningful about the candidate
- Return ONLY a valid JSON array of objects with keys: "question" (string), "type" (string: "technical"|"behavioral"|"situational"), "why" (string: one sentence on what it reveals)
- No markdown, no explanation, just the JSON array`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    const questions = JSON.parse(text);
    res.json({ questions, role, level });
  } catch (err) {
    console.error('[Gemini] Questions error:', err.message);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

// ── Gemini: AI Integrity Analysis of interview report ─────────
// POST /api/gemini/analyze  { trustScore, alerts, duration, counts, verdict }
app.post('/api/gemini/analyze', async (req, res) => {
  const { trustScore, alerts = [], duration, counts = {}, verdict, candidateName, role: jobRole } = req.body;
  const model = getGemini();
  if (!model) return res.status(503).json({ error: 'Gemini API key not configured' });

  const alertSummary = alerts.length
    ? alerts.slice(0, 10).map(a => `- [${(a.sev||'').toUpperCase()}] ${a.msg || a.title}: ${a.desc||''}`).join('\n')
    : 'No alerts recorded.';

  const prompt = `You are an AI interview integrity analyst. Analyze this proctoring session report and provide a professional assessment.

Session Data:
- Candidate: ${candidateName || 'Unknown'}
- Job Role: ${jobRole || 'Not specified'}
- Trust Score: ${trustScore}/100
- Verdict: ${verdict}
- Duration: ${duration}
- Gaze Drift Events: ${counts.gaze || 0}
- Multiple Face Events: ${counts.multi || 0}
- Tab Switch Events: ${counts.tab || 0}
- No Face Events: ${counts.noface || 0}
- Multi Voice Events: ${counts.voice || 0}

Alert Log:
${alertSummary}

Write a professional integrity report with:
1. Overall Assessment (2-3 sentences)
2. Key Risk Factors (bullet points, only if any)
3. Recommendation (one clear recommendation: Proceed / Review Further / Reject)
4. Confidence Level (High/Medium/Low) with reason

Keep it concise, professional, and objective. Plain text only, no markdown symbols.`;

  try {
    const result = await model.generateContent(prompt);
    const analysis = result.response.text();
    res.json({ analysis, model: 'gemini-2.0-flash-lite', generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[Gemini] Analyze error:', err.message);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

// ── SPA fallback ─────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🛡️  campro server running → http://localhost:${PORT}`);
  console.log(`   Health check → http://localhost:${PORT}/health\n`);
});