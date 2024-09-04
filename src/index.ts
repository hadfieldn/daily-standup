import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { WebClient } from '@slack/web-api';
import moment from 'moment-timezone';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

// Load environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY!;
const SLACK_API_TOKEN = process.env.SLACK_API_TOKEN!;
const SLACK_STANDUP_CHANNEL = process.env.SLACK_STANDUP_CHANNEL!;
const SLACK_USER_ID = process.env.SLACK_USER_ID!;
const USE_STANDUP_CHANNEL = process.env.USE_STANDUP_CHANNEL! === 'true';
const HOLIDAYS = process.env.HOLIDAYS?.split(',') || [];

const slackClient = new WebClient(SLACK_API_TOKEN);

const IN_PROGRESS_STATUS_NAME = 'In Progress';
const SUBMITTED_STATUS_NAME = 'Code Review';
const MERGED_STATUS_NAME = 'Testing';

export const handler = async () => {
  const timeZone = 'America/Denver';
  const now = moment().tz(timeZone);
  const today = now.clone().startOf('day');
  const yesterday = addWeekdays(today.clone(), -1, HOLIDAYS);
  // don't report issues that were created more than 2 months ago
  const issueCutoff = today.clone().add(-2, 'months');
  // don't report issues that have been in progress more than 5 days
  const inProgressCutoff = addWeekdays(today.clone(), -7, HOLIDAYS);

  console.log('Generating standup report', {
    today: today.format('YYYY-MM-DD'),
    yesterday: yesterday.format('YYYY-MM-DD'),
    issueCutoff: issueCutoff.format('YYYY-MM-DD'),
    inProgressCutoff: inProgressCutoff.format('YYYY-MM-DD'),
  });

  // Initialize Google Calendar API client
  const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

  // Get Google Calendar events
  const yesterdayEvents = await getCalendarEvents(
    calendar,
    yesterday,
    yesterday.clone().endOf('day')
  );
  const todayEvents = await getCalendarEvents(calendar, today, today.clone().endOf('day'));

  if (isWeekend(today)) {
    console.log('Skipping standup because it is a weekend');
    return {
      statusCode: 200,
      body: 'Skipping standup because it is a weekend.',
    };
  }

  if (isHoliday(today, HOLIDAYS)) {
    console.log('Skipping standup because it is a holiday');
    return {
      statusCode: 200,
      body: 'Skipping standup because it is a holiday.',
    };
  }


  const vacationEvent = detectVacationEvent(todayEvents);
  if (vacationEvent) {
    console.log(`Skipping standup because of out-of-office event '${vacationEvent}'`);
    return {
      statusCode: 200,
      body: `Skipping standup because of out-of-office event '${vacationEvent}'.`,
    };
  }

  // Get Linear issues
  const yesterdayIssues = await getLinearIssues({
    start: yesterday,
    end: today,
    issueCutoff,
    inProgressCutoff,
  });
  const todayIssues = await getLinearIssues({
    start: today,
    end: now,
    issueCutoff,
    inProgressCutoff,
  });

  // Prepare Slack message
  const slackMessage = await prepareSlackMessage({
    yesterdayEvents,
    todayEvents,
    yesterdayIssues,
    todayIssues,
  });

  console.log('Prepared slack message:', { slackMessage });

  // Schedule Slack message
  // (NOTE: we don't schedule the message, we assume the Lambda function will be invoked at the scheduled time)
  const standupChannelId = await getStandupChannelId();
  await sendSlackMessage(standupChannelId, slackMessage);

  return {
    statusCode: 200,
    body: 'Handled successfully',
  };
};

/**
 * Check if a given date is one of the holidays listed in `holidays.
 */
function isHoliday(date: moment.Moment, holidays: string[]): boolean {
  const holidaySet = new Set(holidays.map((holiday) => moment(holiday).format('YYYY-MM-DD')));
  return holidaySet.has(date.format('YYYY-MM-DD'));
}

/**
 * Add weekdays to a moment date, skipping weekends and holidays
 */
function addWeekdays(startDate: moment.Moment, daysToAdd: number, holidays: string[] = []) {
  let absDaysToAdd = Math.abs(daysToAdd);
  let addedDays = 0;
  let increment = daysToAdd > 0 ? 1 : -1;

  const date = startDate.clone();

  while (addedDays < absDaysToAdd) {
    date.add(increment, 'days');

    if (isWeekend(date)) {
      continue;
    }

    if (isHoliday(date, holidays)) {
      console.log('Skipping holiday', date.format('YYYY-MM-DD'));
      continue;
    }

    addedDays++;
  }

  return date;
}

/**
 * Check if a moment date falls on a weekend (Saturday or Sunday)
 */
function isWeekend(date: moment.Moment) {
  return date.isoWeekday() === 6 || date.isoWeekday() === 7;
}

/**
 * Get events from the Google Calendar API
 */
async function getCalendarEvents(
  calendar: any,
  start: moment.Moment,
  end: moment.Moment
): Promise<string[]> {
  const response = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items || [];
  return events
    .filter(
      (event) =>
        event.summary &&
        event.transparency !== 'opaque' &&
        !event.description?.toLowerCase().includes('personal') &&
        event.summary.toLowerCase().trim() !== 'busy'
    )
    .map((event) => event.summary);
}

/**
 * Get issues from the Linear API
 */
async function getLinearIssues({
  start,
  end,
  issueCutoff,
  inProgressCutoff,
}: {
  /** starting date for searching updates */
  start: moment.Moment;
  /** ending date for searching updates */
  end: moment.Moment;
  /** no issues created before this date will be included */
  issueCutoff: moment.Moment;
  /** no issues set to in-progress status before this date will be included */
  inProgressCutoff: moment.Moment;
}): Promise<{ inProgress: string[]; submitted: string[]; merged: string[] }> {
  const url = 'https://api.linear.app/graphql';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `${LINEAR_API_KEY}`,
  };

  const query = /* graphql */ `
query ($start: DateTimeOrDuration!, $end: DateTimeOrDuration!, $cutoff: DateTimeOrDuration){
      issues(filter: {and: [
        { assignee: { isMe: { eq: true } } }, 
        { children: { length: { eq: 0 }} },
        { createdAt: { gte: $cutoff }},
        { state: { name: { in: ["${IN_PROGRESS_STATUS_NAME}", "${SUBMITTED_STATUS_NAME}", "${MERGED_STATUS_NAME}"] } } }
        { or: [
            { and: [{ updatedAt: { gte: $cutoff lte: $end } }, 
                    { state: { name: { eq: "${IN_PROGRESS_STATUS_NAME}" } } }] },
            { and: [{ updatedAt: { gte: $start lte: $end } }, 
                    { state: { name: { neq: "${IN_PROGRESS_STATUS_NAME}" } } }] },
          ], 
        },
        ]}) {
        nodes {
          id
          title
          state {
            name
          }
          updatedAt
          identifier
          history {
            nodes {
              toState {
                name
              }
              createdAt
              fromState {
                name
              }
            }
          }
        }
      }
    }    `;

  const variables = {
    start: start.toISOString(),
    end: end.toISOString(),
    cutoff: issueCutoff.toISOString(),
  };
  const response = await axios.post(url, { query, variables }, { headers });

  const issues = response.data.data.issues.nodes;
  const stateChangedTo = (issue: any, stateName: string, options: { after?: moment.Moment } = {}) =>
    issue.history.nodes.some((node: any) => {
      const didChangeToState =
        node.toState?.name === stateName && node.fromState?.name !== stateName;
      if (options.after) {
        return didChangeToState && moment(node.createdAt) >= options.after;
      }
      return didChangeToState;
    });

  const formatIssue = (issue: any) => `${issue.identifier} ${issue.title}`;

  return {
    inProgress: issues
      .filter((issue: any) =>
        stateChangedTo(issue, IN_PROGRESS_STATUS_NAME, {
          after: inProgressCutoff,
        })
      )
      .map(formatIssue),
    submitted: issues
      .filter((issue: any) => stateChangedTo(issue, SUBMITTED_STATUS_NAME))
      .map(formatIssue),
    merged: issues
      .filter((issue: any) => stateChangedTo(issue, MERGED_STATUS_NAME))
      .map(formatIssue),
  };
}

/**
 * Prepare a Slack message with the given events and issues.
 *
 * Shows yesterday's events and yesterday's submitted and merged issues under "Did".
 * Shows today's events and today's in-progress issues under "Doing".
 *
 */
async function prepareSlackMessage({
  yesterdayEvents,
  yesterdayIssues,
  todayEvents,
  todayIssues,
}: {
  yesterdayEvents: string[];
  yesterdayIssues: { submitted: string[]; merged: string[] };
  todayEvents: string[];
  todayIssues: { inProgress: string[] };
}): Promise<string> {
  let message = (await getLlmHappyGreeting(new Date())) + '\n\n';

  message += '*Did*\n';

  yesterdayEvents.forEach((event) => {
    message += `• ${event}\n`;
  });

  const mergedSet = new Set(yesterdayIssues.merged);
  const processedIssues = new Set<string>();

  // Handle issues that are only submitted
  yesterdayIssues.submitted.forEach((issue) => {
    if (!mergedSet.has(issue)) {
      message += `• Submitted ${issue}\n`;
      processedIssues.add(issue);
    }
  });

  // Handle issues that are both submitted and merged
  yesterdayIssues.submitted.forEach((issue) => {
    if (mergedSet.has(issue)) {
      message += `• Submitted/merged ${issue}\n`;
      processedIssues.add(issue);
    }
  });

  // Handle issues that are only merged
  yesterdayIssues.merged.forEach((issue) => {
    if (!processedIssues.has(issue)) {
      message += `• Merged ${issue}\n`;
    }
  });

  message += '\n*Doing*\n';

  todayEvents.forEach((event) => {
    message += `• ${event}\n`;
  });

  todayIssues.inProgress.forEach((issue) => {
    message += `• ${issue}\n`;
  });

  return message;
}

/**
 * Use an LLM to generate a happy greeting based on the weather condition
 * Defaults to `
 */
async function getLlmHappyGreeting(date: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const { weatherCondition, temperature } = await getCurrentWeatherAndTemperature(date);
  console.log(`Current weather: ${weatherCondition}, temperature: ${temperature}`);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `
            You are a cheerful, hip, and chill. You speak like a surfer dude who loves people and life. 
            You create happy greetings, using groovy language about the way you are currently feeling. 
            But you don't sound cheesy or cutesy.
          `,
        },
        {
          role: 'user',
          content: `
            Generate a happy greeting using just two or three words that reflects the way you feel today and/or the emotions you want to send out to brighten others' day.
            Do not use phrasing that sounds like an instruction. (For example, don't say "Be happy" or "Have a great day.")
            Don't use any form of these words: vibe, joy.
            Prefer greetings that use alliteration.
            Follow the greeting with one or two emojis that correspond to the current weather condition of "${weatherCondition}", or a happy or positive idea (smiling face, rainbow, sunflower, rocket, etc). 
            The greeting may include the day of the week (today is ${weekday}).
            Do not use words to fit the emoji. Use emoji that fit the greeting.
            Use surfing emoji sparingly, only if it fits the greeting well.
            Use sunflower emoji sparingly, only if it fits the greeting well.
            Prefer the use of only a single emoji, unless a second emoji fits the greeting well.
            Ideally, one of the emojis will correspond an idea or word in the greeting.
            Important: follow each emoji with a space character so that there will be a gap between emojis.
            Use terse language, e.g., instead of saying "I'm feeling great," say "Feeling great".
            If the temperature is unusually high or low, you can highlight it in the greeting, e.g., "It's an icy Monday!", and add an appropriate emoji (e.g., snowflake for cold, thermometer for hot). 
            (The current temperature is ${temperature} degrees Fahrenheit. Normal temperature is between 45 and 85 degrees Fahrenheit.) 
          `,
        },
      ],
      max_tokens: 50,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating happy greeting:', error);
    return happyGreeting(date); // Fallback to the existing happy greeting function
  }
}

/**
 * Generate a happy greeting using emojis based on the weather condition
 */
async function happyGreeting(date: Date) {
  const { weatherCondition } = await getCurrentWeatherAndTemperature(date);
  const weatherEmoji = await getCurrentWeatherEmoji(weatherCondition);
  const weekdayLong = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
  }).format(date);

  const greetings = ['Good morning!', `Happy ${weekdayLong}!`, `${weekdayLong}!`];

  const greeting = greetings[Math.floor(Math.random() * greetings.length)];
  return `${greeting} ${weatherEmoji}`;
}

/**
 * Get a weather emoji based on the weather condition
 */
async function getCurrentWeatherEmoji(weatherCondition: string) {
  switch (weatherCondition) {
    case 'clear':
      return '☀️';
    case 'clouds':
      return '🌥️';
    case 'rain':
      return '🌧️';
    case 'drizzle':
      return '🌦️';
    case 'thunderstorm':
      return '⛈️';
    case 'snow':
      return '🌨️';
    case 'mist':
      return '😶‍🌫️';
    case 'fog':
      return '😶‍🌫️';
    default:
      return '🌤️';
  }
}

/**
 * call into a weather api and return an emoji based on the weather
 */
async function getCurrentWeatherAndTemperature(date: Date) {
  const API_KEY = process.env.WEATHER_API_KEY; // Make sure to add this to your .env file
  const LATITUDE = 40.233845; // Provo, UT
  const LONGITUDE = -111.658531;

  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?lat=${LATITUDE}&lon=${LONGITUDE}&appid=${API_KEY}&units=imperial`
    );
    const weatherCondition = response.data.weather[0].main.toLowerCase();
    const temperature = Math.round(response.data.main.temp);
    return { weatherCondition, temperature };
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return { weatherCondition: 'unknown', temperature: 'unknown' }; // Return unknown weather and null temperature if there's an error
  }
}

async function sendSlackMessage(
  channelId: string,
  message: string,
  options: { scheduleAt?: moment.Moment } = {}
) {
  try {
    if (options.scheduleAt) {
      await slackClient.chat.scheduleMessage({
        channel: channelId,
        text: message,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message,
            },
          },
        ],
        post_at: options.scheduleAt?.unix(),
      });
    } else {
      await slackClient.chat.postMessage({
        channel: channelId,
        text: message,
        mrkdwn: true,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message,
            },
          },
        ],
      });
    }
  } catch (error) {
    console.error('Error scheduling Slack message:', error);
  }
}

async function getStandupChannelId(): Promise<string | undefined> {
  if (USE_STANDUP_CHANNEL) {
    return SLACK_STANDUP_CHANNEL;
  }
  let channelId = await getDirectMessageChannelId(SLACK_USER_ID);
  if (!channelId) {
    console.error('Failed to get channel ID.');
    return;
  }
  return channelId;
}

async function getDirectMessageChannelId(userId: string): Promise<string | undefined> {
  try {
    const response = await slackClient.conversations.open({ users: userId });
    return response.channel?.id;
  } catch (error) {
    console.error('Error getting DM channel ID:', error);
    return undefined;
  }
}

function detectVacationEvent(todayEvents: string[]) {
  const outOfOfficeRegex = /ooo|pto|vacation|out of office/i;
  return todayEvents.find((event) => outOfOfficeRegex.test(event));
}

// ----------------------------------------------------------------------------
// Local execution

if (require.main === module) {
  (async () => {
    try {
      const result = await handler(); // Call handler function directly
      console.log('Local run result:', result);
    } catch (error) {
      console.error('Error running locally:', error);
    }
  })();
}
