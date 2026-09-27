import type { ReactNode } from "react";
import { LandingFooter } from "../components/landing/LandingFooter";
import { LandingNav } from "../components/landing/LandingNav";
import { container } from "../components/landing/ui";

const CONTACT = "privacy@atmyshelf.com";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-pretty text-[15px] leading-relaxed text-(--color-text-dim) [&_b]:font-semibold [&_b]:text-(--color-text) [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

const contactLink = (
  <a href={`mailto:${CONTACT}`} className="font-semibold text-(--color-text) underline decoration-(--color-accent) underline-offset-4">
    {CONTACT}
  </a>
);

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-(--color-bg) text-(--color-text)">
      <LandingNav />
      <main className={`${container} py-14 sm:py-20`}>
        <article className="max-w-2xl">
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">Privacy</h1>
          <p className="mt-3 text-sm text-(--color-text-dim)">Last updated 27 September 2026</p>
          <p className="mt-8 text-pretty text-lg leading-relaxed text-(--color-text-dim)">
            Atmyshelf is a personal library for the books you read. This page explains what we keep, why, who helps us
            run the service, and what you can do about it. We don't sell your data, show ads, or use analytics or
            tracking cookies.
          </p>

          <Section title="Who we are">
            <p>
              Atmyshelf runs atmyshelf.com and its apps, and is responsible for the personal data described here. For
              questions or requests, write to {contactLink}.
            </p>
          </Section>

          <Section title="What we keep">
            <ul>
              <li>
                <b>Your account:</b> your email address, username, and password, which is stored only as a one-way
                hash. If you sign in with Google, we ask Google for your email address and basic profile, and keep your
                email address and Google account ID.
              </li>
              <li>
                <b>Your library:</b> the books you import or add, with their titles, authors, ISBNs, reading status and
                dates, ratings, reviews, highlights and notes, and the series, collections, styles and murals you make.
                When you import a file from Kobo, Goodreads or StoryGraph, we read it to extract your books and delete
                the file straight away.
              </li>
              <li>
                <b>Images you upload:</b> your profile picture and the images in your gallery.
              </li>
              <li>
                <b>Community and games, if you use them:</b> the people you follow, your published profile, and the tier
                lists, tournaments and votes you create. Votes cast without an account are linked to a random code
                stored in your browser.
              </li>
              <li>
                <b>Connected social accounts, if you connect one:</b> the access token or app password for that
                platform, stored encrypted and used only for what you ask Atmyshelf to do there.
              </li>
              <li>
                <b>Launch list, if you join it:</b> the email address you enter to hear when Atmyshelf launches; we use
                it only to confirm you joined and to tell you about the launch, and delete it if you ask.
              </li>
              <li>
                <b>Server logs:</b> like most websites, our servers record technical details of each request, including
                your IP address. We use them only to run and protect the service.
              </li>
            </ul>
          </Section>

          <Section title="Why we use it">
            <p>
              To provide the service you signed up for: keeping your library, showing it to you on your devices, sharing
              what you choose to share, signing you in, and sending account emails such as email verification and
              password recovery. We also use it to keep accounts secure, for example by limiting repeated sign-in
              attempts. Where EU or UK law applies, we rely on our contract with you and on our legitimate interest in
              keeping the service secure.
            </p>
          </Section>

          <Section title="What other people can see">
            <p>
              Your library is private until you decide otherwise. Others can see your things only when you share your
              library or a mural at a link, publish your profile, or create a public tier list, tournament or vote.
              Anyone with a share link can view it without an account. You can stop sharing at any time, and a revoked
              link stops working.
            </p>
          </Section>

          <Section title="Who helps us run Atmyshelf">
            <ul>
              <li>
                <b>Railway</b> hosts our servers and the data they store.
              </li>
              <li>
                <b>Cloudflare</b> serves the website and carries traffic to our servers.
              </li>
              <li>
                <b>Resend</b> delivers account emails and launch-list confirmations, so it receives your email address and the message.
              </li>
              <li>
                <b>Google</b>, only if you choose to sign in with Google.
              </li>
              <li>
                <b>X, Instagram, Threads, TikTok or Bluesky</b>, only if you connect that account.
              </li>
              <li>
                <b>Book services:</b> to find covers, our servers send a book's ISBN, title or author to Open Library,
                Google Books, Kobo and Hardcover, with nothing about you attached. When you search for a book to add,
                your browser asks Open Library directly, so Open Library sees that search and your IP address.
              </li>
            </ul>
            <p>These providers may process data outside your country, including in the United States.</p>
          </Section>

          <Section title="What's stored in your browser">
            <p>
              We don't use cookies. The website keeps your sign-in session in your browser's storage: for the current tab
              only, or, if you choose "Remember me", until you log out or the session expires. It also keeps a few
              preferences, a cache of cover image addresses, and the voting code mentioned above. Clearing this site's
              data removes them.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              We keep your data while your account exists. When you delete your account, in Settings, we delete it along
              with your library, images and everything else linked to it straight away. Votes you cast on other people's
              tier lists and tournaments stay counted but are no longer linked to you. Server logs are kept for a limited
              period by our hosting provider. The launch list has no account attached, so we keep an address on it until
              you ask us to remove it.
            </p>
          </Section>

          <Section title="Your choices and rights">
            <ul>
              <li>Edit or remove books, murals, gallery images and your profile picture in the app at any time.</li>
              <li>Change your email or password, stop sharing, disconnect social accounts, or delete your account in Settings.</li>
              <li>To get a copy of your data or correct it, write to {contactLink}.</li>
              <li>
                If you're in the EU or UK, you can also complain to your local data protection authority.
              </li>
            </ul>
          </Section>

          <Section title="Changes">
            <p>When the service changes in a way that affects your data, we'll update this page and the date at the top.</p>
          </Section>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
