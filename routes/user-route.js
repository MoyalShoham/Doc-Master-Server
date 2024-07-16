const express = require('express');
const router = express.Router();
const { auth, db } = require('../fireBase-Config');
const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
const { addDoc, collection, setDoc } = require('firebase/firestore');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/user-model');
const { set, update } = require('firebase/database');
const { doc } = require('firebase/firestore');
const { arrayUnion, arrayRemove } = require('firebase/firestore');
const { updateDoc } = require('firebase/firestore');
const { getDocs, query, where } = require('firebase/firestore');
const authMiddleware = require('../common/auth-middleware');
const { getStorage, ref, uploadBytes} = require('firebase/storage');
const { getDownloadURL } = require('firebase/storage');
const uuid = require('uuid-v4');
const admin = require("firebase-admin");

const serviceAccount = require("../doc-master-server-firebase-adminsdk-8sor4-7f05846648.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://doc-master-server-rtdb.firebaseio.com",
  storageBucket: "doc-master-server.appspot.com"
});

const bucket = admin.storage().bucket();

const storage = multer.memoryStorage();

const upload = multer({ storage: storage });


// const firebase_storage = getStorage();

// const storageRef = ref(firebase_storage, 'uploads/');

// Set the base URL for the uploaded files
const base = 'http://localhost:3000/uploads/';








// // Configure multer storage
// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//         cb(null, 'uploads/');
//     },
//     filename: function (req, file, cb) {
//         cb(null, file.originalname);
//     },
// });

// const upload = multer({ storage: storage });


const generateTokens = (userId) => {
    console.log('generateTokens:', userId);
    const accessToken = jwt.sign(
      {
        uid: userId,
      },
      process.env.TOKEN_SECRET,
      {
        expiresIn: process.env.TOKEN_EXPIRATION,
      }
    );
  
    const refreshToken = jwt.sign(
      {
        uid: userId,
        salt: Math.random(),
      },
      process.env.REFRESH_TOKEN_SECRET
    );
  
    return {
      accessToken: accessToken,
      refreshToken: refreshToken,
    };
  };

const refresh = async (req, res) => {
    //extract token from http header
    const authHeader = req.headers['authorization'];
    const refreshTokenOrig = authHeader && authHeader.split(' ')[1];

    if (refreshTokenOrig == null) {
        return res.status(401).send("missing token");
    }

    //verify token
    jwt.verify(refreshTokenOrig, process.env.REFRESH_TOKEN_SECRET, async (err, userInfo) => {
        if (err) {
            return res.status(403).send("invalid token");
        }

        try {
            const user = await User.findById(userInfo._id);
            if (user == null || user.tokens == null || !user.tokens.includes(refreshTokenOrig)) {
                if (user.tokens != null) {
                    user.tokens = [];
                    await user.save();
                }
                return res.status(403).send("invalid token");
            }

            //generate new access token
            const { accessToken, refreshToken } = generateTokens(user._uid.toString());

            //update refresh token in db
            user.tokens = user.tokens.filter(token => token != refreshTokenOrig);
            user.tokens.push(refreshToken);
            await user.save();

            //return new access token & new refresh token
            return res.status(200).send({
                accessToken: accessToken,
                refreshToken: refreshToken
            });
        } catch (error) {
            console.log(error);
            return res.status(400).send(error.message);
        }
    });

}




const register = async (req, res) =>  {

    try {
        const { full_name, email, password } = req.body;

        if (email == null || password == null) {
            return res.status(400).send("missing email or password");
        }

        try{
            const docRef = await createUserWithEmailAndPassword(auth, email, password);
            const userObj = docRef.user;
        }catch(error){
            return res.status(400).send(error.message);
        }


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

const getUsers = async (req, res) => {
    const userQuery = query(collection(db, "users"));
    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
        return res.status(400).send("user not found");
    } else {
        let users = [];
        querySnapshot.forEach((doc) => {
            let userData = doc.data();
            // Remove the 'tokens' key from userData
            // let { tokens, ...userWithoutTokens } = userData;

            users.push(userData);
        });
        return res.status(200).send(users);
    }
};


router.get('/', getUsers);



const login = async (req, res) => {

    console.log('Login Request:', req.body);
    const { email, password } = req.body;
    
    if (email == null || password == null) {
        return res.status(400).send("missing email or password");
    }

    try {
        const user = await signInWithEmailAndPassword(auth, email, password);
        
        if (user == null) {
            return res.status(400).send("invalid email or password");
        }

        const userObj = user.user;
        userObj.tokens = null;
        const { accessToken, refreshToken } = generateTokens(userObj.uid);

        if (user.tokens == null) {
            user.tokens = [refreshToken];
        } else {
            user.tokens.push(refreshToken);
        }


        const userQuery = query(collection(db, "users"), where("_uid", "==", userObj.uid));

        const querySnapshot = await getDocs(userQuery);

        if (querySnapshot.empty) {
            return res.status(400).send("user not found");
        }
        else {
            const userDocRef = querySnapshot.docs[0].ref;
            
            await updateDoc(userDocRef, {
                tokens: arrayUnion(refreshToken)        
            })

        }

        // const userDocRef = doc(db, "users", userObj.uid);

        // await u(doc(db, "users", userObj.uid), userObj);



        // await user.save();
        return res.status(200).send({
            accessToken: accessToken,
            refreshToken: refreshToken,
            user: userObj
        });
    } catch (error) {
        console.log(error);
        return res.status(400).send(error.message);
    }
}

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
    console.log('User:', req.body);
    const user = req.body.user.uid;


    // console.log('User:', user);

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

    // console.log('Usssssser:', user);

    const blob = bucket.file(`${user}_${req.file.originalname}`);
    const blobStream = blob.createWriteStream({
        metadata: metadata,
        gzip: true
    });

    
    const userQuery = query(collection(db, "users"), where("_uid", "==", user));

    const querySnapshot = await getDocs(userQuery);

    if (querySnapshot.empty) {
        return res.status(400).send("user not found");
    }
    else {
        const userDocRef = querySnapshot.docs[0].ref;
        
        await updateDoc(userDocRef, {
            posts: arrayUnion(`https://storage.googleapis.com/${bucket.name}/${blob.name}`)        
        })

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


// delete file

router.delete('/delete', authMiddleware, async (req, res) => {

    const file_url = req.body.file_url;
    console.log('File URL:', file_url);

    const fileName = file_url.split('/').pop();

    const user = req.body.user.uid;

    const userQuery = query(collection(db, "users"), where("_uid", "==", user));

    const querySnapshot = await getDocs(userQuery);

    const blob = bucket.file(fileName);


    if (querySnapshot.empty) {
        return res.status(400).send("user not found");
    }
    else {
        const userDocRef = querySnapshot.docs[0].ref;

        
        await updateDoc(userDocRef, {
            posts: arrayRemove(file_url)
        })

    }

    

    blob.delete().then(() => {
        res.status(200).send('File deleted');
    }).catch((error) => {
        res.status(400).send('Error deleting file');
    });
});


module.exports = router;
