/**
 * Email sign-in codes and password-reset links (lib/email.ts, lib/email-auth.ts):
 * the Resend call, the dev outbox, codes used once with a try limit, links
 * used once that close the others, and one verified owner per address.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { devOutbox, EmailError, renderMail, sendEmail } from "@/lib/email";
import { signInCodeMail } from "@/lib/email-messages";
import {
  checkEmailCode,
  EmailAuthError,
  issueEmailCode,
  issuePlatformResetToken,
  issueResetToken,
  normaliseEmail,
  passwordProblem,
  readPlatformResetToken,
  readResetToken,
  spendPlatformResetToken,
  spendResetToken,
  userByVerifiedEmail,
  validEmail,
} from "@/lib/email-auth";

const tag = Date.now().toString(36);
const addr = (n: string) => `${n}-${tag}@example.com`;

describe("sending through Resend", () => {
  it("posts the message with the key and sender, and refuses quietly on an error", async () => {
    const before = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "VBiz Pro <no-reply@vpd.ceo>";
    try {
      const calls: { url: string; init: RequestInit }[] = [];
      const ok = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
      }) as unknown as typeof fetch;
      await sendEmail(signInCodeMail("a@example.com", "Sharma", "123456"), ok);
      expect(calls[0].url).toBe("https://api.resend.com/emails");
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
      const sent = JSON.parse(String(calls[0].init.body));
      expect(sent).toMatchObject({ from: "VBiz Pro <no-reply@vpd.ceo>", to: ["a@example.com"], subject: "123456 is your Sharma sign-in code" });
      expect(sent.text).toContain("123456");

      const refused = (async () => new Response('{"message":"domain not verified"}', { status: 403 })) as unknown as typeof fetch;
      await expect(sendEmail(signInCodeMail("a@example.com", "Sharma", "1"), refused)).rejects.toBeInstanceOf(EmailError);
      const down = (async () => {
        throw new Error("network");
      }) as unknown as typeof fetch;
      await expect(sendEmail(signInCodeMail("a@example.com", "Sharma", "1"), down)).rejects.toBeInstanceOf(EmailError);
    } finally {
      process.env.RESEND_API_KEY = before.key ?? "";
      process.env.EMAIL_FROM = before.from ?? "";
      if (!before.key) delete process.env.RESEND_API_KEY;
      if (!before.from) delete process.env.EMAIL_FROM;
    }
  });

  it("keeps mail in the dev outbox when there's no key (tests and development only)", async () => {
    delete process.env.RESEND_API_KEY;
    const n = devOutbox.length;
    await sendEmail(signInCodeMail("b@example.com", "Sharma", "654321"));
    expect(devOutbox.length).toBe(Math.min(n + 1, 50));
    expect(devOutbox.at(-1)?.subject).toContain("654321");
  });

  it("escapes what goes into the HTML", () => {
    const { html, text } = renderMail({ brand: "A&B <shop>", title: "Hi", lines: ['<script>x</script>"'], link: { label: "Go", url: "https://x.test/?a=1&b=2" } });
    expect(html).not.toContain("<script>");
    expect(html).toContain("A&amp;B &lt;shop&gt;");
    expect(html).toContain("https://x.test/?a=1&amp;b=2");
    expect(text).toContain("Go: https://x.test/?a=1&b=2");
  });
});

describe("addresses and passwords", () => {
  it("normalises and checks addresses", () => {
    expect(normaliseEmail("  Owner@Gmail.COM ")).toBe("owner@gmail.com");
    expect(validEmail("owner@gmail.com")).toBe(true);
    for (const bad of ["", "owner", "owner@", "@gmail.com", "a b@c.com", "a@b.c"]) expect(validEmail(bad)).toBe(false);
  });

  it("asks for 10 characters (12 on the console) and not the login id", () => {
    expect(passwordProblem("short", "ravi")).toMatch(/10/);
    expect(passwordProblem("ravi-is-the-best", "ravi")).toMatch(/login id/);
    expect(passwordProblem("a-long-good-one", "ravi")).toBeNull();
    expect(passwordProblem("eleven-char", null, 12)).toMatch(/12/);
    expect(passwordProblem(undefined, null)).not.toBeNull();
  });
});

describe("codes and links in a business", () => {
  let T = "";
  const made: string[] = [];
  const db = () => tenantDb(T);

  beforeAll(async () => {
    T = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } })).id;
  });
  afterAll(async () => {
    await db().user.deleteMany({ where: { id: { in: made } } });
  });

  const person = async (name: string, email: string | null, verified = true) => {
    const u = await db().user.create({ data: { name, role: "SALES_AGENT", loginId: `${name}-${tag}`, email, emailVerifiedAt: verified && email ? new Date() : null } });
    made.push(u.id);
    return u;
  };

  it("finds a login only by an address it verified", async () => {
    const a = await person("verified", addr("v"));
    await person("typed", addr("t"), false);
    expect((await userByVerifiedEmail(db(), addr("v").toUpperCase()))?.id).toBe(a.id);
    expect(await userByVerifiedEmail(db(), addr("t"))).toBeNull();
  });

  it("lets only one login in a business verify an address", async () => {
    await person("first", addr("same"));
    // Upper-case is the same address (the plain unique key on email alone would let it through).
    await expect(person("second", addr("same").toUpperCase())).rejects.toMatchObject({ code: "P2002" });
  });

  it("uses a sign-in code once, for its own purpose, within 5 tries", async () => {
    const u = await person("coder", addr("c"));
    const email = addr("c");
    const code = await issueEmailCode(db(), u.id, email, "SIGN_IN");
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "111111" ? "222222" : "111111";
    expect(await checkEmailCode(db(), { email, purpose: "VERIFY", code })).toBeNull();
    expect(await checkEmailCode(db(), { email, purpose: "SIGN_IN", code: wrong })).toBeNull();
    expect((await checkEmailCode(db(), { email, purpose: "SIGN_IN", code }))?.userId).toBe(u.id);
    expect(await checkEmailCode(db(), { email, purpose: "SIGN_IN", code })).toBeNull();

    const again = await issueEmailCode(db(), u.id, email, "SIGN_IN");
    const bad = again === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) expect(await checkEmailCode(db(), { email, purpose: "SIGN_IN", code: bad })).toBeNull();
    await expect(checkEmailCode(db(), { email, purpose: "SIGN_IN", code: again })).rejects.toBeInstanceOf(EmailAuthError);
  });

  it("refuses an expired code and sends at most 3 per 10 minutes", async () => {
    const u = await person("slow", addr("s"));
    const email = addr("s");
    const past = Date.now() - 11 * 60_000;
    const old = await issueEmailCode(db(), u.id, email, "VERIFY", past);
    expect(await checkEmailCode(db(), { userId: u.id, purpose: "VERIFY", code: old })).toBeNull();
    // That one was saved just now, so it counts: two more make three.
    await issueEmailCode(db(), u.id, email, "VERIFY");
    await issueEmailCode(db(), u.id, email, "VERIFY");
    await expect(issueEmailCode(db(), u.id, email, "VERIFY")).rejects.toMatchObject({ status: 429 });
  });

  it("opens a reset link once and closes the person's other links", async () => {
    const u = await person("resetter", addr("r"));
    const first = await issueResetToken(db(), u.id, addr("r"));
    const second = await issueResetToken(db(), u.id, addr("r"));
    const [id, secret] = second.split(".");
    expect(await readResetToken(db(), `${id}.${secret.slice(0, -2)}xx`)).toBeNull();
    expect(await readResetToken(db(), "junk")).toBeNull();
    const c = await readResetToken(db(), second);
    expect(c?.userId).toBe(u.id);
    expect(await spendResetToken(db(), c!.id, u.id)).toBe(true);
    expect(await spendResetToken(db(), c!.id, u.id)).toBe(false);
    expect(await readResetToken(db(), second)).toBeNull();
    expect(await readResetToken(db(), first)).toBeNull();
  });

  it("refuses a reset link after 30 minutes", async () => {
    const u = await person("late", addr("l"));
    const token = await issueResetToken(db(), u.id, addr("l"), Date.now() - 31 * 60_000);
    expect(await readResetToken(db(), token)).toBeNull();
  });
});

describe("console reset links", () => {
  let id = "";
  beforeAll(async () => {
    id = (await prisma.platformUser.create({ data: { email: addr("console"), name: "Console test", passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await prisma.platformUser.delete({ where: { id } });
    await prisma.$disconnect();
  });

  it("work once, close the others, and expire", async () => {
    const a = await issuePlatformResetToken(id);
    const b = await issuePlatformResetToken(id);
    const r = await readPlatformResetToken(b);
    expect(r?.platformUserId).toBe(id);
    expect(await spendPlatformResetToken(r!.id, id)).toBe(true);
    expect(await readPlatformResetToken(a)).toBeNull();
    expect(await readPlatformResetToken(b)).toBeNull();
    expect(await readPlatformResetToken(await issuePlatformResetToken(id, Date.now() - 31 * 60_000))).toBeNull();
  });
});
