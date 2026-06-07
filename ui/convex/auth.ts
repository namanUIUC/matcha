import { Phone } from "@convex-dev/auth/providers/Phone";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Phone({
      id: "phone",
      maxAge: 60 * 10,
      async generateVerificationToken() {
        return Math.floor(100000 + Math.random() * 900000).toString();
      },
      async sendVerificationRequest({ identifier: phone, token }) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_FROM_PHONE;

        if (!accountSid || !authToken || !from) {
          console.log(
            `[auth] Dev OTP for ${phone}: ${token} (no Twilio provider configured)`,
          );
          return;
        }

        const spokenDigits = token.split("").join(", ");
        const twiml =
          `<Response>` +
          `<Pause length="1"/>` +
          `<Say voice="alice">Your Matcha verification code is ${spokenDigits}.</Say>` +
          `<Pause length="1"/>` +
          `<Say voice="alice">I repeat, ${spokenDigits}.</Say>` +
          `</Response>`;

        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
          {
            method: "POST",
            headers: {
              Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: from,
              To: phone,
              Twiml: twiml,
            }).toString(),
          },
        );
        if (!res.ok) {
          throw new Error(
            `Twilio Voice failed: ${res.status} ${await res.text()}`,
          );
        }
      },
    }),
  ],
});
