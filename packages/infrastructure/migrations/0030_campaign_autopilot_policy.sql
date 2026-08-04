ALTER TABLE "campaigns" ADD COLUMN "autopilot_policy" jsonb DEFAULT '{
  "version": 1,
  "enabled": true,
  "schedule": {
    "activeDays": [1, 2, 3, 4, 5],
    "windowStart": "09:00",
    "windowEnd": "17:00",
    "timezoneMode": "recipient",
    "fallbackTimezone": "Europe/Paris"
  },
  "email": {
    "language": "auto",
    "firstMessageInstructions": null,
    "followUpInstructions": null,
    "followUpDelaysBusinessDays": [4, 10],
    "autoReplyEnabled": true,
    "replyDelayMinutes": 2,
    "replyInstructions": null,
    "bookingUrl": null,
    "stopOnHumanActivity": true
  }
}'::jsonb NOT NULL;
