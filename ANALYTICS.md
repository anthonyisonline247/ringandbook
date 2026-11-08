# Website conversion measurement

Ring & Booked sends these Google Analytics 4 events only after a visitor selects **Allow analytics**. Event payloads must not include names, email addresses, phone numbers, message text, or account identifiers.

| Event | Trigger | Suggested GA4 key event |
| --- | --- | --- |
| `start_setup_click` | A visitor opens the onboarding flow | No — use as funnel entry |
| `watch_demo_click` | A visitor opens the standalone video-demo page | No — use as engagement |
| `video_start` | A visitor starts the YouTube demonstration | No — use as engagement |
| `select_plan` | A visitor chooses Starter or Growth | No — use as funnel entry |
| `begin_checkout` | The site receives a valid Stripe Checkout URL and sends the visitor to it | No — use as checkout funnel entry |
| `upgrade_plan_click` | An active Starter customer opens the Growth upgrade flow | No — use as upgrade funnel entry |
| `generate_lead` | EmailJS confirms a contact-form request was sent | Yes — mark as a GA4 key event |
| `sign_up` | A password-based account creation succeeds | Optional — mark only if it is a meaningful business conversion |

Stripe remains the source of truth for completed subscriptions. Do not treat `begin_checkout` as a completed sale. If Stripe has a reliable server-side completion event or webhook destination for analytics, add a separate server-side `purchase`/subscription conversion only after confirming consent and data-handling requirements.
