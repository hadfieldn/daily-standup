# Daily Standup

Lambda function that generates a daily standup report for a Slack channel, based on Google Calendar events and Linear issues.

## Prerequisites:

- Node.js and npm installed.
- Google Calendar API credentials (OAuth 2.0).
- Linear API token.
- Slack API token with the necessary permissions.
- AWS Lambda environment set up.

## Setup and deployment

1. Configure AWS Lambda:

- Create a new Lambda function in the AWS Management Console.
- Set the runtime to Node.js.
- Build the deployment package: `npm run prepare-deploy`
- Upload `lambda-deployment-package.zip` to the Lambda function.

2. Environment Variables:

- Set the following environment variables in your Lambda function configuration:
  - GOOGLE_CLIENT_ID: Your Google API client ID.
  - GOOGLE_CLIENT_SECRET: Your Google API client secret.
  - GOOGLE_REFRESH_TOKEN: Your Google API refresh token.
  - LINEAR_API_KEY: Your Linear API token.
  - SLACK_API_TOKEN: Your Slack API token.
  - SLACK_USER_ID: Your Slack user ID. You can find your Slack User ID by clicking on your profile in Slack, selecting "Profile," and looking under "More actions" for "Copy Member ID." It usually starts with a U.
  - USE_STANDUP_CHANNEL: Set to true if you want to use the standup channel, false if you want to use a personal channel.
  - WEATHER_API_KEY: Your OpenWeatherMap API key.
  - OPENAI_API_KEY: Your OpenAI API key.
  - HOLIDAYS: A comma-separated list of holidays in the format YYYY-MM-DD. (Calendar appointments that are detected as vacations will also be skipped.)

3. Permissions:

- Ensure your Lambda function has the necessary permissions to access the internet to make API requests. (Only required if lambda function is inside a VPC.)

4. Set Up CloudWatch Events (EventBridge):

- Schedule the function to run every night at 9 PM Pacific Time. Use a cron expression like cron(0 4 \* _ ? _) for UTC, which corresponds to 9 PM PT.

ADDITIONAL CONSIDERATIONS:

- Secrets Management: Use AWS Secrets Manager or AWS Parameter Store for managing sensitive environment variables securely.
- Error Handling: Enhance error handling and logging for more robust execution.
- Time Zone Adjustments: Ensure that the time zone handling correctly accounts for Daylight Saving Time if applicable.

---

## Getting API keys and tokens

### Getting Your Slack API Token

1. Create a Slack App:

- Go to the Slack API: [Your Apps](https://api.slack.com/apps) page.
- Click the "Create New App" button.
- Choose "From scratch" and provide a name for your app and select the Slack workspace where you want to install the app.

2. Configure App Scopes and Permissions:

- After creating your app, you'll be taken to the app's settings page.
- Go to "OAuth & Permissions" on the left sidebar.
- Scroll down to "Scopes".
- Under "Bot Token Scopes", add the necessary scopes:
  `channels:write,groups:write,mpim:write,im:write`

- Under "User Token Scopes", if you want the app to post as yourself (your user account) rather than as a bot, add the appropriate scopes like:
  - chat:write: Allows the app to send messages on your behalf.
  - channels:read: Allows reading basic information about public channels you are a member of.

1. Install the App to Your Workspace:

- Still under "OAuth & Permissions", scroll up to "OAuth Tokens & Redirect URLs".
  - Click the "Install App to Workspace" button.
  - You will be redirected to a Slack authorization page where you'll need to authorize the app to access your Slack workspace with the specified permissions.
  - Once authorized, you will see your OAuth Access Token under "OAuth Tokens for Your Workspace". This is your Slack API token.

4. Copy the OAuth Access Token:

- The token typically starts with xoxb- for bot tokens or xoxp- for user tokens.
- Copy this token, and store it securely. You will use this token to authenticate API requests to Slack.

5. Test Your Slack API Token:

- To verify that your token works, you can test it using a simple API call. For example, use the Slack API method auth.test to confirm your token is valid:

```bash
$ curl -X POST -H "Authorization: Bearer YOUR_SLACK_API_TOKEN" \
-H "Content-Type: application/json" \
https://slack.com/api/auth.test
```

Replace YOUR_SLACK_API_TOKEN with your actual token. If the token is valid, the response will include details about the app and workspace.

### Getting a Linear API Key

1. Log In to Your Linear Account:

- Go to the Linear website and log in to your account.

2. Access Your Account Settings:

- Click on your avatar or initials in the top left corner of the Linear interface to open the sidebar menu.
- Click on "Preferences".

3. Navigate to the API Section:

- In the Settings menu, look for the "API" section. This is where you can manage your personal API keys.

4. Create a New API Key:

- Provide a label for your API key. This is for your reference to remember what the key is used for (e.g., "Lambda Function", "Personal Scripts", etc.).
- Optionally, you can also set an expiration date for the key, after which it will no longer be valid. This is a good practice for security.

5. Copy the Generated API Key:

- After clicking "Create", Linear will generate a new API key for you.
- Copy the API key immediately and store it securely. Linear will not show this key again for security reasons.
- You can store this key in a secure location, such as a password manager or an environment variable in your application.

6. Test Your Linear API Key:

- To verify that your API key works, you can test it using a simple API call. For example, use the Linear API to fetch your user profile:

```bash
Copy code
curl -X POST -H "Content-Type: application/json" \
-H "Authorization: Bearer YOUR_LINEAR_API_KEY" \
--data '{ "query": "{ viewer { id name } }" }' \
https://api.linear.app/graphql
```

Replace YOUR_LINEAR_API_KEY with your actual Linear API key. If the key is valid, the response will include details about your Linear user profile.

### Getting Your Google API Credentials

1. Create a Project in Google Cloud Console

- Go to the [Google Cloud Console](https://console.cloud.google.com/)
- Click on the Select a Project dropdown at the top, then click New Project.
- Give your project a name and click Create.

2. Enable the Google Calendar API

- With your project selected, navigate to APIs & Services > Library.
- Search for Google Calendar API.
- Click on Google Calendar API, then click Enable.

3. Create OAuth 2.0 Credentials (Client ID and Client Secret)

- Go to APIs & Services > Credentials.
- Click Create Credentials and select OAuth 2.0 Client ID.

  - If you haven't configured the OAuth consent screen yet, you’ll be prompted to do so:

    - Select External (if you're developing a public app) or Internal (if you're using it within your organization).
    - Click Create.
    - Fill in the required details (App name, User support email, Authorized domains, Developer contact information), then click Save and Continue.
    - (Optional) Add any necessary scopes. Since you're using the Google Calendar API, the scope https://www.googleapis.com/auth/calendar will be required.
    - Complete the remaining steps of the consent screen configuration and click Save and Continue until the process is complete.

  - After configuring the consent screen, you will be redirected back to the Credentials creation page:
    - Application Type: Choose Desktop app (if you're running this locally or for a Lambda function) or Web application (if you're hosting this on a server).
    - Name: Provide a name for the credentials (e.g., "Lambda Function Credentials").
    - Authorized Redirect URIs: If you chose Web application, you'll need to provide a valid redirect URI (e.g., http://localhost or your server's URL). For a desktop app, this isn't required.
    - Click Create.
  - You’ll see your Client ID and Client Secret. Copy these and store them securely.

4. Obtain a Refresh Token

- Generate the Authorization URL:

  Replace YOUR_CLIENT_ID and YOUR_REDIRECT_URI with your details:

```bash
https://accounts.google.com/o/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=https://www.googleapis.com/auth/calendar&access_type=offline
```

- Open the URL in a browser, authorize the app, and get the authorization code.
- Exchange the Authorization Code for Tokens:

```bash
curl \
--request POST \
--data "code=AUTHORIZATION_CODE&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&redirect_uri=urn:ietf:wg:oauth:2.0:oob&grant_type=authorization_code" \
https://oauth2.googleapis.com/token
```

Replace AUTHORIZATION_CODE, YOUR_CLIENT_ID, YOUR_CLIENT_SECRET, and YOUR_REDIRECT_URI with your respective information. This will return an access token and a refresh token in JSON format.

- Store the Credentials Securely
  - Client ID and Secret: Use these for authenticating your application when interacting with Google APIs.
  - Refresh Token: Store it securely and use it to obtain a new access token when the previous one expires.
