require('dotenv').config();

const cors = require('cors');
const express = require('express');
const firebaseAdmin = require('firebase-admin');
const mongoose = require('mongoose');

const UserProfile = require('./models/UserProfile');

const app = express();
const port = Number(process.env.PORT ?? 3000);

let firebaseAdminInitialized = false;

function connectFirebaseAdmin() {
  if (firebaseAdminInitialized) {
    return;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return;
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(serviceAccount),
  });

  firebaseAdminInitialized = true;
}

async function verifyFirebaseToken(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    return next();
  }

  try {
    connectFirebaseAdmin();

    if (!firebaseAdminInitialized) {
      return next();
    }

    const decodedToken = await firebaseAdmin.auth().verifyIdToken(authorization.slice(7));
    req.firebaseUid = decodedToken.uid;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid Firebase token.' });
  }
}

function normalizeContacts(trustedContacts) {
  if (!Array.isArray(trustedContacts)) {
    return [];
  }

  return trustedContacts
    .map((contact) => ({
      name: typeof contact?.name === 'string' ? contact.name.trim() : '',
      phoneNumber: typeof contact?.phoneNumber === 'string' ? contact.phoneNumber.trim() : '',
    }))
    .filter((contact) => contact.name && contact.phoneNumber);
}

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is not configured.');
  }

  await mongoose.connect(mongoUri);

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(verifyFirebaseToken);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/users/profile/:firebaseUid', async (req, res) => {
    const profile = await UserProfile.findOne({ firebaseUid: req.params.firebaseUid }).lean();

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    return res.json({ user: profile });
  });

  app.post('/api/users/profile', async (req, res) => {
    const { firebaseUid, name, phoneNumber, trustedContacts } = req.body ?? {};
    const verifiedUid = req.firebaseUid;
    const effectiveUid = verifiedUid ?? firebaseUid;

    if (verifiedUid && firebaseUid && verifiedUid !== firebaseUid) {
      return res.status(403).json({ message: 'Firebase UID mismatch.' });
    }

    if (!effectiveUid || typeof effectiveUid !== 'string') {
      return res.status(400).json({ message: 'firebaseUid is required.' });
    }

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'name is required.' });
    }

    if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
      return res.status(400).json({ message: 'phoneNumber is required.' });
    }

    const contacts = normalizeContacts(trustedContacts);
    if (contacts.length === 0) {
      return res.status(400).json({ message: 'At least one trusted contact is required.' });
    }

    const user = await UserProfile.findOneAndUpdate(
      { firebaseUid: effectiveUid },
      {
        firebaseUid: effectiveUid,
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        trustedContacts: contacts,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return res.status(201).json({ user });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error.' });
  });

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});