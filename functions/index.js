const functions = require('firebase-functions'),
    admin = require('firebase-admin');

admin.initializeApp(functions.config().firebase);
const stripe = require('stripe')(functions.config().stripe.token),
    currency = functions.config().stripe.currency || 'USD';

const express = require('express');
const router = new express.Router();
const routerNonAuth = new express.Router();
const cors = require('cors')({origin: true});
const helper = require('sendgrid').mail;
const adminEmail = functions.config().emails.admin;
const sg = require('sendgrid')(functions.config().sendgrid.api_key);

/*
const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');

const mailTransport = nodemailer.createTransport(smtpTransport({
    service: 'gmail',
    auth: {
        user: functions.config().gmail.email, // my mail
        pass: functions.config().gmail.password
    }
}));
*/


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
routerNonAuth.use(cors);
router.use(validateFirebaseIdToken);
router.post('/bookservice', (req, res) => {
    const amount = req.body.amount * 100; // as cent
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
                let reservationMessage = `Hi, Reservation have been made from ${req.user.name}. <br/>Below are details of the reservation. <br/><br/>User: ${req.user.name} <br/>Email: ${req.user.email}<br/>Service Type: ${reservationObj.type}<br/>Reservation Date:${reservationObj.reservationDate}<br/>Time: ${reservationObj.reservationTime}`;
                console.log('reservation message', reservationMessage);
                sendEmail(req.user.email, adminEmail, `Reservation made`, 'text/html', reservationMessage, function(error, response) {
                    if (error) {
                        console.log('Sendgrid Error response received',error);
                    } else {
                        console.log('Sendgrid Mail Sent');
                    }
                });
                let reservationMessageToUser = `Hi, Reservation have been successfully made from <br/>Below are details of the reservation. <br/><br/>Service Type: ${reservationObj.type}<br/>Reservation Date:${reservationObj.reservationDate}<br/>Time: ${reservationObj.reservationTime}<br/><br/>If the information is not correct, please contact support team<br/><br/>Best Regards<br/>Support Team`;
                sendEmail(adminEmail, req.user.email, `Reservation made`, 'text/html', reservationMessageToUser, function(error, response) {
                    if (error) {
                        console.log('Sendgrid Error response received',error);
                    } else {
                        console.log('Sendgrid Mail Sent');
                    }
                });
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
routerNonAuth.post('/sendmail', (req, res) => {
/*    const mailOptions = {
        from: req.body.email,
        to: "lucky.man.iwan@gmail.com"
    };

    // The user unsubscribed to the newsletter.
    mailOptions.subject = `Message from ${req.body.fullName}`;
    mailOptions.text = `${req.body.message}`;
    mailTransport.sendMail(mailOptions).then(() => {
        res.send(200, "Email sent successfuly");
    }).catch((error) => {
        console.log('SEnd mail error',  error);
        res.status(500).send(error.message);
    });

*/
    sendEmail(req.body.email, adminEmail, `Message from ${req.body.fullName}`, 'text/plain', req.body.message, function(error, response) {
        if (error) {
            console.log('Sendgrid Error response received',error);
            res.status(500).send(error.message);
        } else {
            res.send(200, "Email sent successfuly");
        }
    });
/*    var fromEmail = new helper.Email(req.body.email);
    var toEmail = new helper.Email(adminEmail);
    var subject = `Message from ${req.body.fullName}`;
    var content = new helper.Content('text/plain', `${req.body.message}`);
    var mail = new helper.Mail(fromEmail, subject, toEmail, content);

    var request = sg.emptyRequest({
        method: 'POST',
        path: '/v3/mail/send',
        body: mail.toJSON()
    });

    sg.API(request, function (error, response) {
        if (error) {
            console.log('Sendgrid Error response received',error);
            res.status(500).send(error.message);
        } else {
            res.send(200, "Email sent successfuly");
        }
    });*/
});

function sendEmail(emailFrom, emailTo, subject, messagType, message, callback) {
    var fromEmail = new helper.Email(emailFrom);
    var toEmail = new helper.Email(emailTo);
    var content = new helper.Content(messagType, `${message}`);
    var mail = new helper.Mail(fromEmail, subject, toEmail, content);

    var request = sg.emptyRequest({
        method: 'POST',
        path: '/v3/mail/send',
        body: mail.toJSON()
    });
    sg.API(request, function (error, response) {
        if(callback) {
            callback(error, response);
        }
    });
}
//
exports.bookservice = functions.https.onRequest((req, res) => {
    req.url = '/bookservice';
    return router(req, res)
});
exports.sendmail = functions.https.onRequest((req, res) => {
    req.url = '/sendmail';
    return routerNonAuth(req, res)
});