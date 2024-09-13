import express from 'express';

const app = express();

// Replace these with your actual Client ID and Client Secret
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';

dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env file');
}
const REDIRECT_URI = 'http://localhost:3000/oauth2callback'; // Ensure this matches your OAuth 2.0 client settings

const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

// Scopes for Google Calendar API
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Step 1: Generate an authentication URL
app.get('/', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // Necessary to obtain a refresh token
    scope: SCOPES,
    prompt: 'consent', // Forces consent screen to ensure a refresh token is returned
  });
  res.send(`
    <h1>Google OAuth 2.0 Authentication</h1>
    <p>Click the link below to authenticate:</p>
    <a href="${authUrl}">Authenticate with Google</a>
  `);
});

// Step 2: Handle the OAuth 2.0 server response
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.send('Error: No code found in the query parameters.');
    return;
  }
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Display the refresh token
    res.send(`
      <h1>Refresh Token Obtained</h1>
      <p>Your refresh token is:</p>
      <code>${tokens.refresh_token}</code>
      <p>Please store this token securely. It allows your application to access your Google Calendar data.</p>
    `);

    // Optionally, you can save the tokens to a file or database here
  } catch (error) {
    console.error('Error retrieving access token:', error);
    res.send('Error retrieving access token. Check the console for more details.');
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log('Visit http://localhost:3000 to start the authentication process.');
});
