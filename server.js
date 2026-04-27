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
