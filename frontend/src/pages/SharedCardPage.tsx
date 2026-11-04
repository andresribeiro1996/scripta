import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { readerCardInputOf } from "@scripta/shared";
import { ApiError } from "../api/client";
import { fetchSharedCard } from "../api/sharedCards";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { ProfileCardHero } from "../components/readerCard/ProfileCardHero";
import { useLocale, useT } from "../i18n";

function InfoScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <Page title={t("shell.areaReaderCard")}>
      <p className="text-sm text-(--color-text-dim)">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className={`${BUTTON_SECONDARY} mt-4`}>
          {t("library.retry")}
        </button>
      ) : null}
    </Page>
  );
}

export function SharedCardPage() {
  const { token } = useParams<{ token: string }>();
  const t = useT();
  const locale = useLocale();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sharedCard", token],
    queryFn: () => fetchSharedCard(token!),
    enabled: Boolean(token),
    retry: false
  });
  const input = useMemo(() => (data ? readerCardInputOf([], [], data.username, locale, data.readerCard) : null), [data, locale]);

  if (!token || (error instanceof ApiError && error.status === 404)) return <InfoScreen message={t("readerCard.sharedInvalid")} />;
  if (error) return <InfoScreen message={t("readerCard.sharedLoadFailed")} onRetry={() => void refetch()} />;
  if (isLoading || !data || !input) return <InfoScreen message={t("library.loadingEllipsis")} />;

  return (
    <Page title={null}>
      <ProfileCardHero input={input}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display min-w-0 break-words text-3xl font-bold lg:text-[2.5rem] lg:leading-[3rem]">@{data.username}</h1>
          <Link to={data.profileVisible ? `/community/u/${data.username}` : "/"} className={BUTTON_PRIMARY}>
            {t("readerCard.openInApp")}
          </Link>
        </div>
      </ProfileCardHero>
    </Page>
  );
}
