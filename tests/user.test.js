const request = require('supertest');
const app = require('../App');

describe('User Routes', () => {
    let token = '';
    it('should register a new user', async () => {
        const response = await request(app)
            .post('/user/register')
            .send({
                full_name: 'John Doe',
                email: 'johndoe@example.com',
                password: 'password123'
            });

        expect(response.status).toBe(201);
        expect(response.text).toContain('John Doe johndoe@example.com password123');
    });

    it('should log in a user', async () => {
        const response = await request(app)
            .post('/user/login')
            .send({
                email: 'johndoe@example.com',
                password: 'password123'
            });

        expect(response.status).toBe(200);
        expect(response.body.accessToken).toBeDefined();
        expect(response.body.refreshToken).toBeDefined();
        expect(response.body.user.email).toBe('johndoe@example.com');
        expect(response.body.user.uid).toBeDefined();
        token = response.body.accessToken;

    });

    it('should get user information', async () => {
        console.log('tokkkkk', token);
        const response = await request(app)
            .get('/user')
            .set('Authorization', 'Bearer ' + token);

        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
        // Add more assertions for user information
    });

    // it('should update file details', async () => {
    //     const response = await request(app)
    //         .put('/updateFileDetails')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .send({
    //             uri: 'https://storage.googleapis.com/bucket/file.jpg',
    //             newName: 'new-file.jpg'
    //         });

    //     expect(response.status).toBe(200);
    //     expect(response.text).toBe('File details updated');
    // });

    // it('should delete a file', async () => {
    //     const response = await request(app)
    //         .delete('/deleteFile')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .send({
    //             fileName: 'file.jpg',
    //             user: {
    //                 uid: 'user-uid-123'
    //             }
    //         });

    //     expect(response.status).toBe(200);
    //     expect(response.text).toBe('File deleted successfully');
    // });

    // it('should upload a file', async () => {
    //     const response = await request(app)
    //         .post('/upload')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .attach('file', 'path/to/file.jpg');

    //     expect(response.status).toBe(200);
    //     expect(response.body.message).toBe('success');
    //     expect(response.body.url).toBeDefined();
    // });

    // it('should rename a file', async () => {
    //     const response = await request(app)
    //         .patch('/renameFile/file.jpg')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .send({
    //             user: {
    //                 uid: 'user-uid-123'
    //             },
    //             newFileName: 'new-file',
    //             expiration_date: '2022-01-01',
    //             reminder: 'true'
    //         });

    //     expect(response.status).toBe(200);
    //     expect(response.body.message).toBe('File renamed successfully');
    //     expect(response.body.url).toBeDefined();
    // });

    // it('should like a document', async () => {
    //     const response = await request(app)
    //         .post('/like')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .send({
    //             user: {
    //                 uid: 'user-uid-123'
    //             },
    //             fileUrl: 'https://storage.googleapis.com/bucket/file.jpg'
    //         });

    //     expect(response.status).toBe(200);
    //     expect(response.text).toBe('Document liked successfully');
    // });

    // it('should unlike a document', async () => {
    //     const response = await request(app)
    //         .post('/unlike')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .send({
    //             user: {
    //                 uid: 'user-uid-123'
    //             },
    //             fileUrl: 'https://storage.googleapis.com/bucket/file.jpg'
    //         });

    //     expect(response.status).toBe(200);
    //     expect(response.text).toBe('Document unliked successfully');
    // });

    // it('should get file metadata', async () => {
    //     const response = await request(app)
    //         .post('/getMetadata')
    //         .set('Authorization', 'Bearer <access-token>')
    //         .send({
    //             item: 'https://storage.googleapis.com/bucket/file.jpg'
    //         });

    //     expect(response.status).toBe(200);
    //     expect(response.body.metadata).toBeDefined();
    //     // Add more assertions for file metadata
    // });

    it('should log out a user', async () => {
        const response = await request(app)
            .get('/user/logout')
            .set('Authorization', 'Bearer ' + token);
        

        expect(response.status).toBe(200);
        expect(response.text).toBe('yes');
    });
});