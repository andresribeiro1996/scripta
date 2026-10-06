import type { ReactNode } from "react";
import { LandingFooter } from "../components/landing/LandingFooter";
import { LandingNav } from "../components/landing/LandingNav";
import { container } from "../components/landing/ui";

const CONTACT = "privacy@atmyshelf.com";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-b border-(--color-border)">
      <summary className="cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden">
        <h2 className="flex min-h-14 items-center justify-between gap-4 py-4 font-sans text-base font-normal">
          {title}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-(--color-text-dim) group-open:rotate-45 motion-safe:transition-transform motion-safe:duration-150">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </h2>
      </summary>
      <div className="space-y-3 pb-6 text-pretty text-sm leading-relaxed text-(--color-text-dim) [&_b]:font-medium [&_b]:text-(--color-text) [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </details>
  );
}

const contactLink = (
  <a href={`mailto:${CONTACT}`} className="font-semibold text-(--color-text) underline decoration-current underline-offset-4">
    {CONTACT}
  </a>
);

export function PrivacyPage() {
  return (
    <div className="flex min-h-svh flex-col bg-(--color-bg) font-sans text-(--color-text) [&_:focus-visible]:outline-(--color-text)!">
      <LandingNav />
      <main className={`${container} w-full flex-1 py-8 sm:py-12`}>
        <article className="mx-auto max-w-xl">
          <h1 className="font-sans text-4xl leading-tight font-light tracking-tight sm:text-5xl">Privacy</h1>
          <p className="mt-3 text-xs text-(--color-text-dim)">Updated <time dateTime="2026-10-06">6 October 2026</time></p>
          <div className="mt-6 space-y-4 text-pretty text-base leading-relaxed text-(--color-text-dim)">
            <p>Join the launch list and we’ll use your email to confirm your place and tell you when Atmyshelf opens. You can ask us to remove it at any time.</p>
            <p>Your library stays private until you choose to share it.</p>
            <p>We don’t sell your data, show ads, or use analytics or tracking cookies.</p>
            <p className="text-sm">Questions or requests? {contactLink}</p>
          </div>

          <div className="mt-8 border-t border-(--color-border)">
            <Section title="Sharing">
              <p>
                Your content stays private unless you choose to publish or share it. Anyone with an active share link
                can view the shared content without an account. You can stop sharing at any time; revoked links stop working.
              </p>
            </Section>

            <Section title="Browser storage">
              <p>
                We don't use cookies. The website keeps your sign-in session in your browser's storage: for the current tab
                only, or, if you choose "Remember me", until you log out or the session expires. It also keeps a few
                preferences, cached image links, and a random code for interactions without an account. Clearing this site's
                data removes them.
              </p>
            </Section>

            <Section title="Retention and deletion">
              <p>
                We keep your data while your account exists. Deleting your account in Settings removes it and its linked
                content straight away. Your contributions to other people's public content may remain in anonymous totals.
                Imported files are deleted once their content has been extracted. Our hosting provider keeps server logs
                for a limited period. Launch-list addresses are kept until you ask us to remove them.
              </p>
            </Section>

            <Section title="Your choices and rights">
              <ul>
                <li>Edit or remove the content you add in the app at any time.</li>
                <li>Manage your account, connections and sharing, or delete your account, in Settings.</li>
                <li>To get a copy of your data or correct it, write to {contactLink}.</li>
                <li>
                  If you're in the EU or UK, you can also complain to your local data protection authority.
                </li>
              </ul>
            </Section>

            <Section title="About Atmyshelf">
              <p>
                Atmyshelf runs atmyshelf.com and its apps, and is responsible for the personal data described here. For
                questions or requests, write to {contactLink}.
              </p>
              <p>
                We keep account details, content and uploads, optional connected-account credentials, interactions,
                and technical logs, including IP addresses, to provide and secure the service. Passwords are hashed;
                connected-account credentials are encrypted. Optional sign-in services provide your email, basic profile
                and account identifier.
              </p>
              <p>
                Hosting, traffic-security and email-delivery partners process the information needed to operate Atmyshelf.
                Platforms you choose to sign in with or connect process information needed for those actions. Book lookup
                services receive book details only; external image hosts can see your IP address. Providers may process
                data outside your country, including in the United States.
              </p>
              <p>
                We use your information to provide the service, send essential emails and protect accounts. Where EU or
                UK law applies, we rely on our contract with you and our legitimate interest in keeping the service secure.
              </p>
              <p>When the service changes in a way that affects your data, we'll update this page and the date at the top.</p>
            </Section>
          </div>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
