# Sign-in (one login for everyone)

Decided 28 Nov 2026 (same shape as VMedics):

- **One page, one way in.** `/login` asks for an email address and emails a one-time code (Resend, 6 digits, 10 minutes, 5 tries). No password, no phone code, no magic link, no Google button on a business address.
- **Authenticator step is off for everyone** (staff, shops, the console). `TWO_STEP_OFF` defaults to off; set `TWO_STEP_OFF=0` to bring it back. Saved secrets are kept.
- **Default role: shopkeeper.** An address nobody has used becomes a `RETAILER` login (`POST /api/auth/email-code/request`). The code proves the address.
- **The admin gives roles by email** (Team page, "Give someone a role", `POST /api/admin/users/role`): a new address gets a login, an existing one keeps it and gets the new role. The person gets a polite email (`roleAssignedMail`) and `User.onboardingDue` is set.
- **First sign-in form** (`/welcome`, `POST /api/onboarding`): shopkeepers describe the shop (this creates the `RetailerProfile`), everyone else confirms name and mobile number. After it, `finishSignIn` sends the person to `roleHome(role)`; `/login` also redirects anyone already signed in.
- Old routes (password, phone OTP, Google, email link) still exist but no business-address screen uses them. The main address still emails a sign-in link per business, because it has no business to send a code from.
