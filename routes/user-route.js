const express = require('express');
const router = express.Router();
const { auth, db } = require('../fireBase-Config');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
const { addDoc, collection, setDoc, getDocs, query, where, updateDoc, arrayUnion, arrayRemove } = require('firebase/firestore');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const admin = require("firebase-admin");
const authMiddleware = require('../common/auth-middleware');
const uuid = require('uuid-v4');
const serviceAccount = require("../doc-master-server-firebase-adminsdk-8sor4-7f05846648.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://doc-master-server-rtdb.firebaseio.com",
  storageBucket: "doc-master-server.appspot.com"
});

const bucket = admin.storage().bucket();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const generateTokens = (userId) => {
  console.log('generateTokens:', userId);
  const accessToken = jwt.sign(
    { uid: userId },
    process.env.TOKEN_SECRET,
    { expiresIn: process.env.TOKEN_EXPIRATION }
  );

  const refreshToken = jwt.sign(
    { uid: userId, salt: Math.random() },
    process.env.REFRESH_TOKEN_SECRET
  );

  return {
    accessToken: accessToken,
    refreshToken: refreshToken,
  };
};

const refresh = async (req, res) => {
  const authHeader = req.headers['authorization'];
  const refreshTokenOrig = authHeader && authHeader.split(' ')[1];

  if (!refreshTokenOrig) {
    return res.status(401).send("Missing token");
  }

  jwt.verify(refreshTokenOrig, process.env.REFRESH_TOKEN_SECRET, async (err, userInfo) => {
    if (err) {
      return res.status(403).send("Invalid token");
    }

    try {
      const userQuery = query(collection(db, "users"), where("_uid", "==", userInfo.uid));
      const querySnapshot = await getDocs(userQuery);

      if (querySnapshot.empty) {
        return res.status(403).send("Invalid token");
      }

      const userDocRef = querySnapshot.docs[0].ref;
      const user = querySnapshot.docs[0].data();

      if (!user.tokens || !user.tokens.includes(refreshTokenOrig)) {
        if (user.tokens) {
          await updateDoc(userDocRef, { tokens: [] });
        }
        return res.status(403).send("Invalid token");
      }

      const { accessToken, refreshToken } = generateTokens(user._uid.toString());
      await updateDoc(userDocRef, {
        tokens: arrayUnion(refreshToken),
        tokens: arrayRemove(refreshTokenOrig)
      });

      return res.status(200).send({
        accessToken: accessToken,
        refreshToken: refreshToken
      });
    } catch (error) {
      console.log(error);
      return res.status(400).send(error.message);
    }
  });
};

const register = async (req, res) => {
  try {
    console.log('Register Request:', req.body);
    const { full_name, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send("Missing email or password");
    }

    const docRef = await createUserWithEmailAndPassword(auth, email, password);
    const userObj = docRef.user;

    console.log('User:', userObj?.uid);
    await addDoc(collection(db, "users"), {
      full_name: full_name,
      email: email,
      _uid: userObj?.uid
    });

    res.status(201).send(`${full_name} ${email} ${password}`);
  } catch (error) {
    res.status(400).send(error.message);
  }
};

const getUser = async (req, res) => {
  const user = req.body.user;
  const userQuery = query(collection(db, "users"), where("_uid", "==", user.uid));
  const querySnapshot = await getDocs(userQuery);

  if (querySnapshot.empty) {
    return res.status(400).send("User not found");
  } else {
    const userData = querySnapshot.docs[0].data();
    return res.status(200).send(userData);
  }
};  

router.get('/', getUser);

const login = async (req, res) => {
  console.log('Login Request:', req.body);
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send("Missing email or password");
  }

  try {
    const user = await signInWithEmailAndPassword(auth, email, password);

    if (!user) {
      return res.status(400).send("Invalid email or password");
    }

    const userObj = user.user;
    const { accessToken, refreshToken } = generateTokens(userObj.uid);

    console.log('User:', userObj.uid);

    const userQuery = query(collection(db, "users"), where("_uid", "==", userObj.uid));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send("User not found");
    }

    const userDocRef = querySnapshot.docs[0].ref;
    await updateDoc(userDocRef, {
      tokens: arrayUnion(refreshToken)
    });

    return res.status(200).send({
      accessToken: accessToken,
      refreshToken: refreshToken,
      user: userObj
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send(error.message);
  }
};

router.post('/register', register);
router.post('/login', login);

router.put('/', authMiddleware, async (req, res) => {
  res.send('User Put');
});

router.delete('/', (req, res) => {
  res.send('User Delete');
});

router.get('/bla-bla', authMiddleware, (req, res) => {
  console.log('User:', req.body.user);
  res.send('User bla-bla ' + req.body.user);
});

router.post('/upload', upload.single('file'), authMiddleware, async (req, res) => {
  console.log('User:', req.body.user);
  const user = req.body.user.uid;

  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const metadata = {
    metadata: {
      fireBaseStorageDownloadTokens: uuid()
    },
    contentType: req.file.mimetype,
    cacheControl: 'public, max-age=31536000',
  };

  const blob = bucket.file(`${user}_${req.file.originalname}`);
  const blobStream = blob.createWriteStream({
    metadata: metadata,
    gzip: true
  });

  const userQuery = query(collection(db, "users"), where("_uid", "==", user));
  const querySnapshot = await getDocs(userQuery);

  if (querySnapshot.empty) {
    return res.status(400).send("User not found");
  } else {
    const userDocRef = querySnapshot.docs[0].ref;
    await updateDoc(userDocRef, {
      posts: arrayUnion(`https://storage.googleapis.com/${bucket.name}/${blob.name}`)
    });
  }

  blobStream.on('error', (err) => {
    console.error(err);
    return res.status(400).send('Error uploading file');
  });

  blobStream.on('finish', async () => {
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
    res.status(200).json({
      message: 'success',
      url: publicUrl,
    });
  });

  blobStream.end(req.file.buffer);
});

router.delete('/delete', authMiddleware, async (req, res) => {
  const file_url = req.body.file_url;
  console.log('File URL:', file_url);

  const fileName = file_url.split('/').pop();
  const user = req.body.user.uid;

  const userQuery = query(collection(db, "users"), where("_uid", "==", user));
  const querySnapshot = await getDocs(userQuery);
  const blob = bucket.file(fileName);

  if (querySnapshot.empty) {
    return res.status(400).send("User not found");
  } else {
    const userDocRef = querySnapshot.docs[0].ref;
    await updateDoc(userDocRef, {
      posts: arrayRemove(file_url)
    });
  }

  blob.delete().then(() => {
    res.status(200).send('File deleted');
  }).catch((error) => {
    res.status(400).send('Error deleting file');
  });
});

module.exports = router;
