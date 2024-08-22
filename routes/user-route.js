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
const { ref, getDownloadURL, getMetadata, deleteObject, uploadBytesResumable, listAll } = require('firebase/storage');
const { storage2 } = require('../fireBase-Config');
const axios = require('axios');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://doc-master-server-rtdb.firebaseio.com",
  storageBucket: "doc-master-server.appspot.com"
});

const bucket = admin.storage().bucket();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Utility function to generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { uid: userId },
    process.env.TOKEN_SECRET,
    { expiresIn: process.env.TOKEN_EXPIRATION }
  );
  const refreshToken = jwt.sign(
    { uid: userId, salt: Math.random() },
    process.env.REFRESH_TOKEN_SECRET
  );
  return { accessToken, refreshToken };
};

// Refresh tokens endpoint
const refreshTokens = async (req, res) => {
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

      return res.status(200).send({ accessToken, refreshToken });
    } catch (error) {
      console.log(error);
      return res.status(400).send(error.message);
    }
  });
};

// Register a new user
const registerUser = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).send("Missing email or password");
    }

    const docRef = await createUserWithEmailAndPassword(auth, email, password);
    const userObj = docRef.user;

    await addDoc(collection(db, "users"), {
      full_name,
      email,
      _uid: userObj?.uid,
      likedDocs: [] // Initialize likedDocs field
    });

    res.status(201).send(`${full_name} ${email} ${password}`);
  } catch (error) {
    res.status(400).send(error.message);
  }
};

// Get user information
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

// Login a user
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).send("Missing email or password");
    }

    const user = await signInWithEmailAndPassword(auth, email, password);
    if (!user) {
      return res.status(400).send("Invalid email or password");
    }

    const userObj = user.user;
    const { accessToken, refreshToken } = generateTokens(userObj.uid);

    const userQuery = query(collection(db, "users"), where("_uid", "==", userObj.uid));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send("User not found");
    }

    const userDocRef = querySnapshot.docs[0].ref;
    await updateDoc(userDocRef, { tokens: arrayUnion(refreshToken) });

    return res.status(200).send({
      accessToken,
      refreshToken,
      user: userObj
    });
  } catch (error) {
    return res.status(400).send(error.message);
  }
};

// Update file details
const updateFileDetails = async (req, res) => {
  console.log('Update File Details Request:', req.body);
  const { uri, newName } = req.body;

  if (!uri || !newName) {
    return res.status(400).send("Missing URI or new name");
  }

  try {
    // Implement the logic to update file details here

    res.status(200).send('File details updated');
  } catch (error) {
    res.status(400).send('Error updating file details');
  }
};

// Delete a file
const deleteFile = async (req, res) => {
  const file_url = req.body.file_url;
  const fileName = file_url.split('/').pop();
  const user = req.body.user.uid;

  try {
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

    await blob.delete();
    res.status(200).send('File deleted');
  } catch (error) {
    res.status(400).send('Error deleting file');
  }
};

// Upload a file
const uploadFile = async (req, res) => {
  const user = req.body.user.uid;
  const { name, expiration_date, reminder } = req.body;

  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const metadata = {
    metadata: { firebaseStorageDownloadTokens: uuid() },
    contentType: req.file.mimetype,
    cacheControl: 'public, max-age=31536000',
  };

  const blob = bucket.file(`${user}_${req.file.originalname}`);
  const blobStream = blob.createWriteStream({ metadata, gzip: true });

  blobStream.on('error', (err) => {
    console.error(err);
    return res.status(400).send('Error uploading file');
  });

  blobStream.on('finish', async () => {
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${user}_${req.file.originalname}`;
    await blob.makePublic();

    const userQuery = query(collection(db, "users"), where("_uid", "==", user));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send("User not found");
    } else {
      const userDocRef = querySnapshot.docs[0].ref;
      await updateDoc(userDocRef, {
        posts: arrayUnion({
          url: publicUrl,
          type: req.file.mimetype.includes('image') ? 'image' : 'file',
          name: name || null,
          expiration_date: expiration_date || null,
          reminder: reminder === 'true'
        }),
      });
    }

    res.status(200).json({ message: 'success', url: publicUrl });
  });

  blobStream.end(req.file.buffer);
};

// Rename a file
const renameFile = async (req, res) => {
  try {
    const user = req.body.user.uid;
    const oldFileName = req.params.fileName;
    let newFileName = req.body.newFileName;

    if (!oldFileName || !newFileName) {
      return res.status(400).send("Missing old or new file name");
    }

    const userQuery = query(collection(db, "users"), where("_uid", "==", user));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send("User not found");
    }

    const userDocRef = querySnapshot.docs[0].ref;
    const userDoc = querySnapshot.docs[0].data();

    // Update the file reference in Firestore
    const updatedPosts = userDoc.posts.map(post => 
      post.url.includes(oldFileName) ? { ...post, url: post.url.replace(oldFileName, newFileName), name: newFileName } : post
    );

    await updateDoc(userDocRef, { posts: updatedPosts });

    // Rename the file in Firebase Storage
    const oldBlob = bucket.file(oldFileName);
    const newBlob = bucket.file(newFileName);

    await new Promise((resolve, reject) => {
      oldBlob.copy(newBlob, (err) => {
        if (err) {
          reject(err);
        } else {
          oldBlob.delete().then(() => resolve()).catch(err => reject(err));
        }
      });
    });

    res.status(200).send('File renamed successfully');
  } catch (error) {
    console.error(error);
    res.status(400).send('Error renaming file');
  }
};

// Like a document
const likeDocument = async (req, res) => {
  const { userId, fileUrl } = req.body;

  if (!userId || !fileUrl) {
    return res.status(400).send("Missing user ID or file URL");
  }

  try {
    const userQuery = query(collection(db, "users"), where("_uid", "==", userId));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send("User not found");
    }

    const userDocRef = querySnapshot.docs[0].ref;

    await updateDoc(userDocRef, {
      likedDocs: arrayUnion(fileUrl)
    });

    res.status(200).send('Document liked successfully');
  } catch (error) {
    console.error(error);
    res.status(400).send('Error liking document');
  }
};

// Unlike a document
const unlikeDocument = async (req, res) => {
  const { userId, fileUrl } = req.body;

  if (!userId || !fileUrl) {
    return res.status(400).send("Missing user ID or file URL");
  }

  try {
    const userQuery = query(collection(db, "users"), where("_uid", "==", userId));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send("User not found");
    }

    const userDocRef = querySnapshot.docs[0].ref;

    await updateDoc(userDocRef, {
      likedDocs: arrayRemove(fileUrl)
    });

    res.status(200).send('Document unliked successfully');
  } catch (error) {
    console.error(error);
    res.status(400).send('Error unliking document');
  }
};

// Export the routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/user', authMiddleware, getUser);
router.put('/updateFileDetails', authMiddleware, updateFileDetails);
router.delete('/deleteFile', authMiddleware, deleteFile);
router.post('/upload', authMiddleware, upload.single('file'), uploadFile);
router.put('/renameFile/:fileName', authMiddleware, renameFile);
router.post('/like', authMiddleware, likeDocument); // New route for liking documents
router.post('/unlike', authMiddleware, unlikeDocument); // New route for unliking documents

module.exports = router;
