const functions = require('firebase-functions'),
    admin = require('firebase-admin');

admin.initializeApp(functions.config().firebase);
const stripe = require('stripe')(functions.config().stripe.token),
    currency = functions.config().stripe.currency || 'USD';

const express = require('express');
const router = new express.Router();
const cors = require('cors')({origin: true});

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const validateFirebaseIdToken = (req, res, next) => {
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        console.error('No Firebase ID token was passed as a Bearer token in the Authorization header.',
            'Make sure you authorize your request by providing the following HTTP header:',
            'Authorization: Bearer <Firebase ID Token>');
        res.status(403).send('Unauthorized');
        return;
    }
    const idToken = req.headers.authorization.split('Bearer ')[1];
    admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
        req.user = decodedIdToken;
        next();
    }).catch(error => {
        console.error('Error while verifying Firebase ID token:', error);
        res.status(403).send('Unauthorized');
    });
};
router.use(cors);
router.use(validateFirebaseIdToken);
router.post('/bookservice', (req, res) => {
    const amount = req.body.amount;
    const card = req.body.token;
    let charge = {amount, currency, card};

    return stripe.charges.create(charge).then(response => {
            // If the result is seccessful, write it back to the database
            let reservationObj = req.body.reservation;
            reservationObj.transactionId = response.id;
            reservationObj.client = {
                uid: req.user.user_id,
                email: req.user.email,
                name: req.user.name,
                avatar: req.user.picture
            };
            reservationObj.userId = req.user.user_id;

            admin.database().ref(`/reservations`).push(reservationObj).then(snapshot => {
                res.send(200, reservationObj);
            }).catch(error => {
                res.status(500).send(error.message);
            });
        }, error => {
            // We want to capture errors and render them in a user-friendly way, while
            // still logging an exception with Stackdriver
            console.log("Stripe charge error", error)
            res.status(500).send(error.message);
        }
    );
});

//
exports.bookservice = functions.https.onRequest((req, res) => {
    req.url = '/bookservice';
    return router(req, res)
});
