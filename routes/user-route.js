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
const {storage2} = require('../fireBase-Config')
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
      _uid: userObj?.uid
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


async function downloadFileAsBuffer(url) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}
const renameFile = async (req, res) => {
  try {
    const user = req.body.user.uid;
    const oldFileName = req.params.fileName;
    let newFileName = req.body.newFileName;

    if (!oldFileName || !newFileName) {
      return res.status(400).send('Missing old or new file name.');
    }

    // Ensure the new file name has the correct extension
    const fileExtension = oldFileName.split('.').pop();
    if (!newFileName.includes('.')) {
      newFileName = `${newFileName}.${fileExtension}`;
    }

    const oldFileRef = bucket.file(oldFileName);
    const newFileRef = bucket.file(newFileName);

    // Step 1: Download the old file
    const [fileData] = await oldFileRef.download();
    console.log('Old file data downloaded successfully');

    // Step 2: Upload the file to the new name with the original metadata
    const [oldFileMetadata] = await oldFileRef.getMetadata();
    console.log('Old file metadata retrieved:', oldFileMetadata);

    const newMetadata = {
      contentType: oldFileMetadata.contentType,
      customMetadata: oldFileMetadata.customMetadata, // Preserve any custom metadata
    };

    await newFileRef.save(fileData, {
      metadata: newMetadata,
      gzip: true, // Enable Gzip compression
    });
    console.log('File uploaded to new location successfully');

    // Step 3: Make the new file public
    await newFileRef.makePublic();
    console.log('New file made public successfully');

    // Step 4: Delete the old file
    await oldFileRef.delete();
    console.log('Old file deleted successfully');

    // Step 5: Update Firestore with the new file name
    const userQuery = query(collection(db, "users"), where("_uid", "==", user));
    const querySnapshot = await getDocs(userQuery);

    if (!querySnapshot.empty) {
      const userDocRef = querySnapshot.docs[0].ref;
      const updatedPosts = querySnapshot.docs[0].data().posts.map(post => 
        post.url.includes(oldFileName) ? { ...post, url: post.url.replace(oldFileName, `${newFileName}`) } : post
      );

      await updateDoc(userDocRef, {
        posts: updatedPosts
      });
      console.log('Firestore updated with new file name');
    } else {
      console.error('User not found in Firestore');
      return res.status(400).send('User not found in Firestore');
    }

    // Return the new file name
    res.status(200).send({ success: true, newFileName: `${user}_${newFileName}` });
  } catch (error) {
    console.error('Error renaming file:', error);
    res.status(500).send({ success: false, message: 'Error renaming file', error: error.message });
  }
};






// Route handlers
router.patch('/rename/:fileName', authMiddleware, renameFile);
router.get('/', authMiddleware, getUser);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.put('/', authMiddleware, updateFileDetails);
router.delete('/delete', authMiddleware, deleteFile);
router.post('/upload', upload.single('file'), authMiddleware, uploadFile);

module.exports = router;
