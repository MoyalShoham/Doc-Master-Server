const express = require('express');
const dotenv = require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('user/upload/', express.static('uploads'));



const userRoute = require('./routes/user-route');
app.use('/user', userRoute);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
