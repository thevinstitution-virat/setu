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

export function setPasswordMail(to: string, brand: string, url: string): Mail {
  return {
    to,
    subject: `Set your ${brand} password`,
    ...renderMail({
      brand,
      title: "Choose your password",
      lines: [`VBiz Pro made an admin login for you at ${brand}.`, "Open the link to choose your password. It works for 3 days, once."],
      link: { label: "Choose your password", url },
      footer: "If you weren't expecting this, ignore this email and tell the business owner.",
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

/** The label a role goes by in emails and forms. */
export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  SALES_AGENT: "Sales agent",
  DELIVERY_AGENT: "Delivery agent",
  SUPERVISOR: "Supervisor",
  ACCOUNTANT: "Accountant",
  RETAILER: "Shopkeeper",
};

const ROLE_WHAT: Record<string, string> = {
  ADMIN: "run the office: orders, shops, stock, money and your team",
  SALES_AGENT: "visit your shops, take orders on the spot and collect payments",
  DELIVERY_AGENT: "see your trips, deliver orders and collect cash",
  SUPERVISOR: "look after your field team: their day, their targets and their reports",
  ACCOUNTANT: "keep the books: accounts, banks, purchases, GST and TDS",
  RETAILER: "order stock, track deliveries and see your khata",
};

/**
 * Sent when an admin gives someone a role (a new person, or a shopkeeper whose role changes).
 * Polite and complete: who did it, what the role is for, and exactly how to start.
 */
export function roleAssignedMail(to: string, brand: string, o: { name: string; role: string; byName: string; loginUrl: string; changed: boolean }): Mail {
  const label = ROLE_LABEL[o.role] ?? o.role;
  const first = o.name.trim().split(/\s+/)[0] || "there";
  const what = ROLE_WHAT[o.role] ?? "do your work";
  return {
    to,
    subject: o.changed ? `Your role at ${brand} is now ${label}` : `You have been added to ${brand} as ${label}`,
    ...renderMail({
      brand,
      title: o.changed ? `Your role is now ${label}` : `Welcome to ${brand}`,
      lines: [
        `Dear ${first},`,
        o.changed
          ? `${o.byName} has updated your role at ${brand}. You are now a ${label}, so you can ${what}.`
          : `${o.byName} has added you to ${brand} as a ${label}. You can ${what}.`,
        "There is no password to remember. To sign in, open the link below, type this email address, and we will email you a one-time code. It works for 10 minutes.",
        "The first time, you will see a short form for your role (about a minute). After that, signing in takes you straight to your own dashboard.",
        "If you have any trouble, just reply to the person who added you, or contact the office.",
        "Warm regards,",
        `${brand}`,
      ],
      link: { label: "Sign in", url: o.loginUrl },
      footer: "Not expecting this email? You can ignore it. Nobody can sign in without a code sent to this address.",
    }),
  };
}
