import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "missbethanieashton@gmail.com";

function baseTemplate(body: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 0; background: #f6f6f6; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
    .wrapper { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #202120; padding: 32px 40px; text-align: center; }
    .header-title { color: #ffffff; font-size: 13px; letter-spacing: 3px; text-transform: uppercase; margin-top: 12px; opacity: 0.6; }
    .body { padding: 40px; }
    .body h1 { font-size: 22px; color: #202120; margin: 0 0 16px; font-weight: 700; }
    .body p { font-size: 15px; color: #555; line-height: 1.7; margin: 0 0 16px; }
    .video-box { background: #f9f9f9; border: 1px solid #e8e8e8; border-radius: 10px; padding: 20px; margin: 24px 0; }
    .video-box p { margin: 0; font-size: 14px; color: #777; }
    .video-box a { color: #677A67; font-weight: 600; text-decoration: none; }
    .cta-wrap { text-align: center; margin: 32px 0; }
    .cta { display: inline-block; background: #677A67; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 700; padding: 14px 36px; border-radius: 50px; letter-spacing: 0.5px; }
    .cta:hover { background: #556655; }
    .note { font-size: 12px; color: #aaa; text-align: center; margin-top: 8px; }
    .footer { background: #202120; padding: 24px 40px; text-align: center; }
    .footer p { color: #ffffff; opacity: 0.4; font-size: 11px; margin: 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:2px;">MATERIALIZED</div>
      <div class="header-title">Video Commerce Platform</div>
    </div>
    <div class="body">
      ${body}
    </div>
    <div class="footer">
      <p>&copy; 2026 Materialized. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
  await resend.emails.send({
    from: `Materialized <${FROM_ADDRESS}>`,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
}

// ── Email Verification ─────────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  email: string;
  displayName: string;
  verifyUrl: string;
}): Promise<void> {
  const firstName = opts.displayName.split(" ")[0];
  const body = `
    <h1>Welcome to Materialized, ${firstName}!</h1>
    <p>
      Thank you for joining the future of video commerce. To get started,
      please verify your email address by clicking the button below.
    </p>
    <div class="cta-wrap">
      <a href="${opts.verifyUrl}" class="cta">Verify My Email</a>
    </div>
    <p class="note">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
  `;
  await sendEmail(opts.email, "Verify your Materialized account", baseTemplate(body));
}

// ── Brand Outreach ─────────────────────────────────────────────────────────

export async function sendBrandOutreachEmail(opts: {
  prContactName: string;
  prContactEmail: string;
  creatorDisplayName: string;
  brandName: string;
  videoTitle: string;
  videoPreviewUrl: string;
  authorizeUrl: string;
  creatorMessage?: string;
}): Promise<void> {
  const firstName = opts.prContactName.split(" ")[0];
  const body = `
    <h1>Hey ${firstName},</h1>
    <p>
      <strong>${opts.creatorDisplayName}</strong> would like to make their latest video featuring
      <strong>${opts.brandName}</strong> products shoppable using Materialized &mdash; turning it into
      a fully interactive, commission-tracked experience your customers can shop directly from.
    </p>
    ${opts.creatorMessage ? `<p style="font-style:italic;border-left:3px solid #677A67;padding-left:14px;color:#444;">"${opts.creatorMessage}"</p>` : ""}
    <div class="video-box">
      <p><strong>${opts.videoTitle || "Video Preview"}</strong></p>
      <p style="margin-top:8px;">You can <a href="${opts.videoPreviewUrl}">preview the video here &rarr;</a></p>
    </div>
    <p>
      Clicking the button below authorises ${opts.creatorDisplayName} to make this video shoppable
      with your brand's products. You'll then receive a <strong>Materialized Brand Agreement</strong>
      (via DocuSign) covering video marketplace commissions.
    </p>
    <div class="cta-wrap">
      <a href="${opts.authorizeUrl}" class="cta">Let's Do This!</a>
    </div>
    <p class="note">If you weren't expecting this email, you can safely ignore it.</p>
  `;
  await sendEmail(
    opts.prContactEmail,
    `${opts.creatorDisplayName} wants to make their video shoppable with ${opts.brandName}`,
    baseTemplate(body)
  );
}

export async function sendBrandAgreementEmail(opts: {
  prContactName: string;
  prContactEmail: string;
  creatorDisplayName: string;
  brandName: string;
  videoTitle: string;
  docuSignUrl: string;
  embedCode: string;
}): Promise<void> {
  const firstName = opts.prContactName.split(" ")[0];
  const body = `
    <h1>Hey ${firstName}, you're almost there!</h1>
    <p>
      Thank you for authorising <strong>${opts.creatorDisplayName}</strong> to make their
      <em>${opts.videoTitle || "video"}</em> shoppable with <strong>${opts.brandName}</strong> products.
    </p>
    <p>
      The next step is to review and sign the <strong>Materialized Brand Agreement</strong>.
      Click below to open the agreement in DocuSign:
    </p>
    <div class="cta-wrap">
      <a href="${opts.docuSignUrl}" class="cta">Review &amp; Sign Agreement</a>
    </div>
    <p>
      Once signed, here is the <strong>embeddable code</strong> for the shoppable video:
    </p>
    <div class="video-box">
      <p style="font-family:monospace;font-size:12px;word-break:break-all;color:#333;">${opts.embedCode.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
    </div>
  `;
  await sendEmail(
    opts.prContactEmail,
    `Your Materialized Brand Agreement — ${opts.brandName} × ${opts.creatorDisplayName}`,
    baseTemplate(body)
  );
}

export async function sendDocuSignReminderEmail(opts: {
  prContactName: string;
  prContactEmail: string;
  brandName: string;
  videoTitle: string;
  docuSignUrl: string;
}): Promise<void> {
  const firstName = opts.prContactName.split(" ")[0];
  const body = `
    <h1>Hey ${firstName}, just a nudge</h1>
    <p>
      You authorised <strong>${opts.brandName}</strong> to feature in a shoppable video on Materialized &mdash;
      that's great! The final step is reviewing and signing the <strong>Materialized Brand Agreement</strong>
      via DocuSign. It takes less than two minutes.
    </p>
    <div class="cta-wrap">
      <a href="${opts.docuSignUrl}" class="cta">Sign the Agreement</a>
    </div>
    <p class="note">Questions? Reply to this email and our team will be happy to help.</p>
  `;
  await sendEmail(
    opts.prContactEmail,
    `Reminder: Your Materialized Brand Agreement is waiting — ${opts.brandName}`,
    baseTemplate(body)
  );
}

export async function sendVideoResultsExcitementEmail(opts: {
  prContactName: string;
  prContactEmail: string;
  brandName: string;
  videoTitle: string;
  videoViews: number;
  videoClicks: number;
  subscribeUrl: string;
}): Promise<void> {
  const firstName = opts.prContactName.split(" ")[0];
  const body = `
    <h1>The results are in, ${firstName}!</h1>
    <p>
      Your shoppable video &mdash; <em>${opts.videoTitle}</em> &mdash; is already making waves.
      Here's a snapshot of how <strong>${opts.brandName}</strong> is performing:
    </p>
    <div class="video-box" style="text-align:center;">
      <p style="font-size:28px;font-weight:800;color:#202120;margin:0;">${opts.videoViews.toLocaleString()}</p>
      <p style="margin-top:4px;color:#677A67;font-weight:600;">Video views</p>
      <p style="font-size:28px;font-weight:800;color:#202120;margin:16px 0 0;">${opts.videoClicks.toLocaleString()}</p>
      <p style="margin-top:4px;color:#677A67;font-weight:600;">Product clicks</p>
    </div>
    <p>
      Imagine scaling this across <strong>hundreds of creator campaigns globally</strong> &mdash; each one driving
      tracked, commission-based sales directly attributed to your brand.
    </p>
    <div class="cta-wrap">
      <a href="${opts.subscribeUrl}" class="cta">Start Your Brand Journey</a>
    </div>
  `;
  await sendEmail(
    opts.prContactEmail,
    `Your video results are in — here's what Materialized did for ${opts.brandName}`,
    baseTemplate(body)
  );
}

export async function sendGlobalPitchEmail(opts: {
  prContactName: string;
  prContactEmail: string;
  brandName: string;
  subscribeUrl: string;
}): Promise<void> {
  const firstName = opts.prContactName.split(" ")[0];
  const body = `
    <h1>Think bigger, ${firstName}.</h1>
    <p>
      One shoppable video is just the beginning. The world's fastest-growing brands are building
      entire creator ecosystems &mdash; and Materialized is the infrastructure that powers them.
    </p>
    <div class="video-box">
      <p>&#10003; <strong>Unlimited shoppable video campaigns</strong> across any creator, any region</p>
      <p>&#10003; <strong>Real-time ROI dashboard</strong> &mdash; revenue, clicks, commissions, by creator</p>
      <p>&#10003; <strong>Affiliate management</strong> &mdash; invite, manage, and pay creators automatically</p>
      <p>&#10003; <strong>Global product catalogue</strong> &mdash; sync your inventory once, sell everywhere</p>
      <p>&#10003; <strong>Stripe Connect payouts</strong> &mdash; automated, compliant, instant</p>
    </div>
    <div class="cta-wrap">
      <a href="${opts.subscribeUrl}" class="cta">Scale ${opts.brandName} Globally</a>
    </div>
  `;
  await sendEmail(
    opts.prContactEmail,
    `${opts.brandName} × Materialized — let's build your global creator programme`,
    baseTemplate(body)
  );
}

export async function sendSubscriptionNudgeEmail(opts: {
  prContactName: string;
  prContactEmail: string;
  brandName: string;
  subscribeUrl: string;
}): Promise<void> {
  const firstName = opts.prContactName.split(" ")[0];
  const body = `
    <h1>Ready to unlock everything, ${firstName}?</h1>
    <p>
      Your shoppable video is live &mdash; and your brand's products are already being discovered by
      new audiences through Materialized. Now it's time to take full control.
    </p>
    <p>
      A <strong>${opts.brandName} Brand subscription</strong> gives you the complete dashboard:
      campaign management, product analytics, affiliate recruitment, and one-click payouts.
    </p>
    <div class="cta-wrap">
      <a href="${opts.subscribeUrl}" class="cta">Subscribe &amp; Unlock Your Dashboard</a>
    </div>
    <p class="note">Your first 14 days are on us. No credit card required to start.</p>
  `;
  await sendEmail(
    opts.prContactEmail,
    `Unlock your full Brand dashboard — ${opts.brandName} × Materialized`,
    baseTemplate(body)
  );
}

export async function sendContactEnquiryEmail(opts: {
  firstName: string;
  surname: string;
  email: string;
  role: string;
  igHandle: string;
  message: string;
}): Promise<void> {
  const roleLabel = opts.role === "creator" ? "Creator" : opts.role === "brand" ? "Brand" : "Publisher";
  const body = `
    <h1>New Contact Enquiry</h1>
    <div class="video-box">
      <p><strong>Name:</strong> ${opts.firstName} ${opts.surname}</p>
      <p><strong>Email:</strong> <a href="mailto:${opts.email}">${opts.email}</a></p>
      <p><strong>Role:</strong> ${roleLabel}</p>
      <p><strong>Instagram:</strong> @${opts.igHandle.replace(/^@/, "")}</p>
    </div>
    <p><strong>Message:</strong></p>
    <p style="background:#f9f9f9;border-left:3px solid #677A67;padding:12px 16px;border-radius:6px;font-style:italic;color:#444;">${opts.message}</p>
  `;
  await sendEmail(
    ADMIN_EMAIL,
    `[Materialized] New ${roleLabel} Enquiry — ${opts.firstName} ${opts.surname}`,
    baseTemplate(body),
    opts.email
  );
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}
