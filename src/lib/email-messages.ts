import { renderMail, type Mail } from "@/lib/email";

/** The emails the sign-in flows send. `brand` is the business name (or the app name on the console). */

const notYou = "If you didn't ask for this, you can ignore this email. Nobody can sign in without the code.";

export function signInCodeMail(to: string, brand: string, code: string): Mail {
  return {
    to,
    subject: `${code} is your ${brand} sign-in code`,
    ...renderMail({
      brand,
      title: "Your sign-in code",
      lines: [`Use this code to sign in to ${brand}. It works for 10 minutes, once.`],
      code,
      footer: notYou,
    }),
  };
}

export function verifyCodeMail(to: string, brand: string, code: string): Mail {
  return {
    to,
    subject: `${code} is your code to add this email to ${brand}`,
    ...renderMail({
      brand,
      title: "Confirm your email address",
      lines: [`Enter this code on the Security page to add this address to your ${brand} login. It works for 10 minutes.`],
      code,
      footer: "If you didn't ask for this, ignore this email: the address won't be added.",
    }),
  };
}

export function resetLinkMail(to: string, brand: string, url: string): Mail {
  return {
    to,
    subject: `Reset your ${brand} password`,
    ...renderMail({
      brand,
      title: "Reset your password",
      lines: ["Someone (we hope you) asked to reset the password for your login.", "The link works for 30 minutes, once. After the reset you sign in again on every device."],
      link: { label: "Choose a new password", url },
      footer: "If you didn't ask for this, ignore this email: your password stays the same.",
    }),
  };
}

export function passwordChangedMail(to: string, brand: string): Mail {
  return {
    to,
    subject: `Your ${brand} password was changed`,
    ...renderMail({
      brand,
      title: "Your password was changed",
      lines: ["The password for your login was just changed with a reset link, and every other signed-in device was signed out."],
      footer: "If this wasn't you, contact the business owner (or support) at once.",
    }),
  };
}
