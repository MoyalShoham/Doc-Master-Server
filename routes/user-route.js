const express = require('express');
const router = express.Router();
const { auth, db, storage2 } = require('../fireBase-Config');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
const { addDoc, collection, setDoc, getDocs, query, where, updateDoc, arrayUnion, arrayRemove } = require('firebase/firestore');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const authMiddleware = require('../common/auth-middleware');
const uuid = require('uuid-v4');
const serviceAccount = require('../doc-master-server-firebase-adminsdk-8sor4-7f05846648.json');
const { ref, getDownloadURL, getMetadata, deleteObject, uploadBytesResumable, listAll } = require('firebase/storage');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://doc-master-server-rtdb.firebaseio.com',
  storageBucket: 'doc-master-server.appspot.com'
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
    return res.status(401).send('Missing token');
  }

  jwt.verify(refreshTokenOrig, process.env.REFRESH_TOKEN_SECRET, async (err, userInfo) => {
    if (err) {
      return res.status(403).send('Invalid token');
    }

    try {
      const userQuery = query(collection(db, 'users'), where('_uid', '==', userInfo.uid));
      const querySnapshot = await getDocs(userQuery);

      if (querySnapshot.empty) {
        return res.status(403).send('Invalid token');
      }

      const userDocRef = querySnapshot.docs[0].ref;
      const user = querySnapshot.docs[0].data();

      if (!user.tokens || !user.tokens.includes(refreshTokenOrig)) {
        if (user.tokens) {
          await updateDoc(userDocRef, { tokens: [] });
        }
        return res.status(403).send('Invalid token');
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
      return res.status(400).send('Missing email or password');
    }

    const docRef = await createUserWithEmailAndPassword(auth, email, password);
    const userObj = docRef.user;

    await addDoc(collection(db, 'users'), {
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
  const userQuery = query(collection(db, 'users'), where('_uid', '==', user.uid));
  const querySnapshot = await getDocs(userQuery);

  if (querySnapshot.empty) {
    return res.status(400).send('User not found');
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
      return res.status(400).send('Missing email or password');
    }

    const user = await signInWithEmailAndPassword(auth, email, password);
    if (!user) {
      return res.status(400).send('Invalid email or password');
    }

    const userObj = user.user;
    const { accessToken, refreshToken } = generateTokens(userObj.uid);

    const userQuery = query(collection(db, 'users'), where('_uid', '==', userObj.uid));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send('User not found');
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
    return res.status(400).send('Missing URI or new name');
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
  const fileUrl = req.body.fileName;
  const user = req.body.user.uid;

  if (!fileUrl) {
    return res.status(400).send('File URL is required');
  }

  try {
    // Extract the file name from the URL
    const fileName = fileUrl.split('/').pop();

    // Query the user's documents
    const userQuery = query(collection(db, 'users'), where('_uid', '==', user));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send('User not found');
    }

    const userDocRef = querySnapshot.docs[0].ref;
    const userDocData = querySnapshot.docs[0].data();

    // Check if the file exists in the user's posts
    const fileExists = userDocData.posts.some(post => post.url === fileUrl);

    if (!fileExists) {
      return res.status(404).send('File not found in user\'s documents');
    }

    // Update the user's Firestore document to remove the file entry
    await updateDoc(userDocRef, {
      posts: arrayRemove(userDocData.posts.find(post => post.url === fileUrl))
    });

    // Delete the file from Firebase Storage
    const blob = bucket.file(fileName);
    await blob.delete();

    res.status(200).send('File deleted successfully');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error deleting file');
  }
};
const uploadFile = async (req, res) => {
  const user = req.body.user.uid;
  const { name, expiration_date, reminder } = req.body;

  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const metadata = {
    metadata: {
      firebaseStorageDownloadTokens: uuid(),
      isLiked: false,
    },
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

    const userQuery = query(collection(db, 'users'), where('_uid', '==', user));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send('User not found');
    } else {
      const userDocRef = querySnapshot.docs[0].ref;
      const updateData = {
        posts: arrayUnion({
          url: publicUrl,
          type: req.file.mimetype.includes('image') ? 'image' : 'file',
          name: name || null,
          expiration_date: expiration_date || null,
          reminder: reminder === 'true'
        }),
      };

      // If the reminder checkbox is checked, add the file to the reminders list
      if (reminder === 'true') {
        updateData.reminders = arrayUnion({
          url: publicUrl,
          name: name || null,
          expiration_date: expiration_date || null
        });
      }

      await updateDoc(userDocRef, updateData);
    }

    res.status(200).json({ message: 'success', url: publicUrl });
  });

  blobStream.end(req.file.buffer);
};


const renameFile = async (req, res) => {
  try {
    const user = req.body.user.uid;
    const oldFileName = `${req.params.fileName}`;
    const newFileNameWithoutExt = req.body.newFileName;
    const { expiration_date, reminder } = req.body;

    if (!oldFileName || !newFileNameWithoutExt) {
      return res.status(400).send('Missing old or new file name');
    }

    // Extract the file extension from the old file name
    const oldFileExtension = oldFileName.split('.').pop();
    
    // Create the new file name with the correct extension
    const newFileName = `${newFileNameWithoutExt}.${oldFileExtension}`;

    console.log(`Attempting to rename file from: ${oldFileName} to: ${newFileName}`);

    // Check if the old file exists
    const oldBlob = bucket.file(oldFileName);
    const [exists] = await oldBlob.exists();

    if (!exists) {
      console.log(`File ${oldFileName} does not exist`);
      return res.status(404).send('File not found in Firebase Storage');
    }

    // Get the old file's metadata
    const [oldMetadata] = await oldBlob.getMetadata();

    // Copy the old metadata and add the required fields
    const newMetadata = {
      metadata: {
        firebaseStorageDownloadTokens: uuid(),
        isLiked: oldMetadata.metadata.isLiked || false,
      },
      contentType: oldMetadata.contentType,
      cacheControl: oldMetadata.cacheControl,
    };

    // Create the new blob with updated metadata
    const newBlob = bucket.file(newFileName);
    const newBlobStream = newBlob.createWriteStream({ metadata: newMetadata, gzip: true });

    // Copy the old file data to the new file
    const oldFileBuffer = await oldBlob.download();
    newBlobStream.end(oldFileBuffer[0]);

    // Handle stream finish and error events
    newBlobStream.on('error', (err) => {
      console.error(`Error creating new file: ${err.message}`);
      return res.status(400).send('Error renaming file');
    });

    newBlobStream.on('finish', async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${newFileName}`;
      await newBlob.makePublic();

      // Check if the user exists in Firestore
      const userQuery = query(collection(db, 'users'), where('_uid', '==', user));
      const querySnapshot = await getDocs(userQuery);

      if (querySnapshot.empty) {
        console.log(`User with UID ${user} not found`);
        return res.status(400).send('User not found');
      }

      const userDocRef = querySnapshot.docs[0].ref;
      const userDoc = querySnapshot.docs[0].data();

      // Update file details in user's document
      const updatedPosts = userDoc.posts.map(post => {
        if (post.url.includes(oldFileName)) {
          const newUrl = post.url.replace(oldFileName, newFileName);
          return {
            ...post,
            url: newUrl,
            name: newFileNameWithoutExt,
            expiration_date: expiration_date || post.expiration_date || null,
            reminder: reminder !== undefined ? reminder === 'true' : post.reminder,
          };
        }
        return post;
      });

      await updateDoc(userDocRef, { posts: updatedPosts });

      // Delete the old file from Firebase Storage
      await oldBlob.delete();

      res.status(200).json({ message: 'File renamed successfully', url: publicUrl });
    });
  } catch (error) {
    console.error(`Error renaming file: ${error.message}`);
    res.status(400).send('Error renaming file');
  }
};

// Like a document
const likeDocument = async (req, res) => {
  const userId = req.body.user.uid;
  const fileUrl = req.body.fileUrl;

  if (!userId || !fileUrl) {
    return res.status(400).send('Missing user ID or file URL');
  }

  try {
    const userQuery = query(collection(db, 'users'), where('_uid', '==', userId));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send('User not found');
    }

    const userDocRef = querySnapshot.docs[0].ref;

    // Update the file metadata to set `isLiked` to true
    try {
      const fileName = fileUrl.split('/').pop(); // Extract file name from URL
      const file = bucket.file(fileName);
      const [metadata] = await file.getMetadata();
      const newMetadata = {
        metadata: {
          ...metadata.metadata,
          isLiked: 'true'  // Set isLiked to true (Note: Firebase metadata values are strings)
        }
      };
      await file.setMetadata(newMetadata);
    } catch (error) {
      console.error(`Error updating file metadata: ${error.message}`);
      return res.status(400).send('Error updating file metadata');
    }

    // Update the Firestore document to include the liked file
    await updateDoc(userDocRef, {
      likedDocs: arrayUnion(fileUrl),
    });

    res.status(200).send('Document liked successfully');
  } catch (error) {
    console.error(error);
    res.status(400).send('Error liking document');
  }
};

// Unlike a document
const unlikeDocument = async (req, res) => {
  const userId = req.body.user.uid;
  const fileUrl = req.body.fileUrl;

  if (!userId || !fileUrl) {
    return res.status(400).send('Missing user ID or file URL');
  }

  try {
    const userQuery = query(collection(db, 'users'), where('_uid', '==', userId));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
      return res.status(400).send('User not found');
    }

    const userDocRef = querySnapshot.docs[0].ref;

    // Update the file metadata to set `isLiked` to false
    try {
      const fileName = fileUrl.split('/').pop();
      const file = bucket.file(fileName);
      const [metadata] = await file.getMetadata();
      const newMetadata = {
        metadata: {
          ...metadata.metadata,
          isLiked: 'false'  // Set isLiked to false
        }
      };
      await file.setMetadata(newMetadata);
    } catch (error) {
      console.error(`Error updating file metadata: ${error.message}`);
      return res.status(400).send('Error updating file metadata');
    }

    // Update the Firestore document to remove the liked file
    await updateDoc(userDocRef, {
      likedDocs: arrayRemove(fileUrl),
    });

    res.status(200).send('Document unliked successfully');
  } catch (error) {
    console.error(error);
    res.status(400).send('Error unliking document');
  }
};
const getFileMetadata = async (req, res) => {
  try {
    // Extract fileUrl from the request body or query parameters
    const fileUrl  = req.body.item; // Assuming it's sent in the request body

    if (!fileUrl) {
      console.log(fileUrl);
      return res.status(400).send('Missing file URL');
    }

    // Assuming the fileUrl format is 'https://storage.googleapis.com/<bucket-name>/<file-path>'
    const filePath = fileUrl.replace(`https://storage.googleapis.com/${bucket.name}/`, '');
    // console.log('File path:', filePath);

    // Initialize Firebase Storage
    const fileRef = ref(storage2, filePath);

    // Get the metadata
    const metadata = await getMetadata(fileRef);

    // console.log('File metadata:', metadata);
    return res.status(200).json({ metadata });
  } catch (error) {
    console.error('Error getting file metadata:', error);
    return res.status(500).send('Error getting file metadata');
  }
};

// Export the routes
router.post('/getMetadata', getFileMetadata);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/', authMiddleware, getUser);
router.put('/updateFileDetails', authMiddleware, updateFileDetails);
router.delete('/deleteFile', authMiddleware, deleteFile);
router.post('/upload', upload.single('file'), authMiddleware, uploadFile);
router.patch('/renameFile/:fileName', authMiddleware, renameFile);
router.post('/like', authMiddleware, likeDocument); // New route for liking documents
router.post('/unlike', authMiddleware, unlikeDocument); // New route for unliking documents

module.exports = router;