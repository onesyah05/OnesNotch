import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "../../components/error-text";
import { RowButton, SectionTitle, SettingsRow, ToggleSwitch } from "../../components/rows";
import {
  ipc,
  type AppError,
  type CaptureTarget,
  type ProviderId,
  type ProviderLoginEvent,
  type ProviderView,
} from "../../lib/ipc";
import { useSettingsStore } from "../../stores/useSettingsStore";

/**
 * Provider, key, model, base URL, capture mode and history. The key field is
 * write-only: the backend answers with `hasKey`, never with the key itself.
 */
export function ProviderSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const apply = useSettingsStore((s) => s.apply);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  // Combines `apply` with UI bookkeeping so rows stay dumb.
  const run = async (request: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      setError(null);
    } catch (err) {
      // Import lazily is overkill; every command rejects with an AppError,
      // but keep the normalization local in case of a transport error.
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <p className="text-sm text-subtle">{t("settings.ai.loading")}</p>;
  }

  const provider = settings.providers.find((p) => p.id === settings.provider);

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title={t("settings.ai.title")} />

      <SettingsRow label={t("settings.ai.provider")} hint={t("settings.ai.providerHint")}>
        <select
          value={settings.provider}
          onChange={(event) =>
            void run(() =>
              apply(() => ipc.settingsUpdate({ provider: event.target.value as ProviderId })),
            )
          }
          className="min-w-0 max-w-44 rounded-md bg-bg px-2 py-1 text-sm text-fg ring-1 ring-elevated outline-none focus:ring-subtle"
        >
          {settings.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`providers.${p.id}`)}
            </option>
          ))}
        </select>
      </SettingsRow>

      {provider && <ProviderConfig key={provider.id} provider={provider} run={run} busy={busy} />}

      <SettingsRow label={t("settings.ai.captureMode")}>
        <ModeSwitch
          modes={[
            ["screen", t("settings.ai.captureModeScreen")],
            ["window", t("settings.ai.captureModeWindow")],
          ]}
          value={settings.captureMode}
          onSelect={(mode) =>
            void run(() => apply(() => ipc.settingsUpdate({ captureMode: mode })))
          }
          busy={busy}
        />
      </SettingsRow>

      <SettingsRow label={t("settings.ai.history")} hint={t("settings.ai.historyHint")}>
        <ToggleSwitch
          checked={settings.historyEnabled}
          onChange={() =>
            void run(() =>
              apply(() => ipc.settingsUpdate({ historyEnabled: !settings.historyEnabled })),
            )
          }
          label={t("settings.ai.history")}
        />
      </SettingsRow>

      {error && <ErrorText error={error} />}
    </div>
  );
}

type Run = (request: () => Promise<unknown>) => Promise<void>;

function normalizeError(err: unknown): AppError {
  if (
    typeof err === "object" &&
    err !== null &&
    typeof (err as AppError).code === "string" &&
    typeof (err as AppError).message === "string"
  ) {
    return err as AppError;
  }
  return { code: "internal", message: err instanceof Error ? err.message : String(err) };
}

function ProviderConfig({
  provider,
  run,
  busy,
}: {
  provider: ProviderView;
  run: Run;
  busy: boolean;
}) {
  const { t } = useTranslation();
  // Models the provider offers, loaded as soon as it is usable (signed in,
  // key saved, or no key needed) so the user picks instead of typing.
  const [models, setModels] = useState<string[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const signedIn = provider.supportsLogin && provider.loggedIn;
  const canList =
    signedIn ||
    provider.hasKey ||
    (!provider.supportsLogin &&
      provider.keyPolicy !== "required" &&
      (provider.baseUrl ?? "") !== "");

  useEffect(() => {
    if (!canList) return;
    let live = true;
    ipc
      .providerTest(provider.id)
      .then((found) => {
        if (live) setModels(found);
      })
      .catch(() => {
        // The Test row reports the error; the picker falls back to typing.
        if (live) setListFailed(true);
      });
    return () => {
      live = false;
    };
  }, [provider.id, canList]);

  const loadingModels = canList && models === null && !listFailed;

  return (
    <div className="flex flex-col gap-2">
      {provider.supportsLogin && <LoginRow provider={provider} run={run} busy={busy} />}

      {provider.keyPolicy !== "none" && <KeyRow provider={provider} run={run} />}

      {provider.baseUrlEditable && <BaseUrlRow provider={provider} run={run} />}

      <ModelRow provider={provider} run={run} models={models} loading={loadingModels} />

      <TestConnectionRow provider={provider} run={run} busy={busy} onModels={setModels} />

      {!provider.hasKey && provider.keyPolicy === "required" && (
        <p className="text-xs text-live">{t("settings.ai.keyRequired")}</p>
      )}
    </div>
  );
}

function KeyRow({ provider, run }: { provider: ProviderView; run: Run }) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");

  const save = () => {
    const value = key.trim();
    if (!value) return;
    void run(() => ipc.providerSetKey(provider.id, value)).then(() => setKey(""));
  };

  return (
    <SettingsRow
      label={t("settings.ai.apiKey")}
      hint={provider.hasKey ? t("settings.ai.keyStored") : t("settings.ai.keyMissing")}
    >
      <input
        type="password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder={t("settings.ai.keyPlaceholder")}
        autoComplete="off"
        className="h-8 w-56 min-w-0 rounded-md bg-bg px-2 text-sm text-fg ring-1 ring-elevated outline-none placeholder:text-muted focus:ring-subtle"
      />
      <RowButton onClick={save} disabled={!key.trim()}>
        {t("settings.ai.save")}
      </RowButton>
      {provider.hasKey && (
        <RowButton onClick={() => void run(() => ipc.providerDeleteKey(provider.id))}>
          {t("settings.ai.deleteKey")}
        </RowButton>
      )}
    </SettingsRow>
  );
}

function LoginRow({ provider, run, busy }: { provider: ProviderView; run: Run; busy: boolean }) {
  const { t } = useTranslation();
  const [loggingIn, setLoggingIn] = useState(false);
  const [device, setDevice] = useState<string | null>(null);

  const login = () => {
    if (busy || loggingIn) return;
    setLoggingIn(true);
    setDevice(null);
    void run(() =>
      ipc
        .providerLoginWithEvents(provider.id, (event: ProviderLoginEvent) => {
          if (event.type === "deviceCode") {
            setDevice(
              t("settings.ai.devicePrompt", { url: event.verificationUrl, code: event.userCode }),
            );
          }
        })
        .then(() => {
          setLoggingIn(false);
          setDevice(null);
        }),
    );
  };

  return (
    <SettingsRow
      label={t("settings.ai.login")}
      hint={
        loggingIn
          ? t("settings.ai.loggingIn")
          : provider.loggedIn
            ? t("settings.ai.loggedIn", { account: provider.accountLabel ?? "" })
            : t("settings.ai.loginHint")
      }
    >
      {loggingIn ? (
        <span className="text-xs text-subtle">{t("settings.ai.loggingIn")}</span>
      ) : (
        <RowButton onClick={login} disabled={busy}>
          {provider.loggedIn ? t("settings.ai.relogin") : t("settings.ai.login")}
        </RowButton>
      )}
      {provider.loggedIn && (
        <RowButton onClick={() => void run(() => ipc.providerLogout(provider.id))}>
          {t("settings.ai.logout")}
        </RowButton>
      )}
      {device && <p className="text-xs text-subtle">{device}</p>}
    </SettingsRow>
  );
}

function BaseUrlRow({ provider, run }: { provider: ProviderView; run: Run }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(provider.baseUrl ?? "");

  return (
    <SettingsRow label={t("settings.ai.baseUrl")} hint={t("settings.ai.baseUrlHint")}>
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder={t("settings.ai.baseUrlPlaceholder")}
        spellCheck={false}
        className="h-8 w-56 min-w-0 rounded-md bg-bg px-2 font-mono text-xs text-fg ring-1 ring-elevated outline-none placeholder:text-muted focus:ring-subtle"
      />
      <RowButton onClick={() => void run(() => ipc.providerUpdate(provider.id, null, url))}>
        {t("settings.ai.save")}
      </RowButton>
    </SettingsRow>
  );
}

const CUSTOM_MODEL = "__custom__";

function ModelRow({
  provider,
  run,
  models,
  loading,
}: {
  provider: ProviderView;
  run: Run;
  models: string[] | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const current = provider.model ?? "";
  const [model, setModel] = useState(current);
  // The list covers what the account offers; "type another" stays available
  // for models the list does not show (new releases, custom servers).
  const [typing, setTyping] = useState(false);
  const hasList = Boolean(models && models.length > 0);
  const selectClass =
    "h-8 w-56 min-w-0 rounded-md bg-bg px-2 font-mono text-xs text-fg ring-1 ring-elevated outline-none focus:ring-subtle disabled:opacity-60";

  const save = (next: string) => void run(() => ipc.providerUpdate(provider.id, next, null));

  if (loading && !typing) {
    return (
      <SettingsRow label={t("settings.ai.model")} hint={t("settings.ai.modelPickHint")}>
        <select disabled aria-label={t("settings.ai.model")} className={selectClass}>
          <option>{t("settings.ai.modelLoading")}</option>
        </select>
      </SettingsRow>
    );
  }

  if (hasList && !typing && models) {
    // Keep a saved model the list no longer offers visible, so it can be seen
    // and replaced rather than silently shown as something else.
    const options = current && !models.includes(current) ? [current, ...models] : models;
    return (
      <SettingsRow label={t("settings.ai.model")} hint={t("settings.ai.modelPickHint")}>
        <select
          value={current}
          aria-label={t("settings.ai.model")}
          onChange={(event) => {
            const next = event.target.value;
            if (next === CUSTOM_MODEL) {
              setModel(current);
              setTyping(true);
              return;
            }
            setModel(next);
            save(next);
          }}
          className={selectClass}
        >
          <option value="">
            {t("settings.ai.modelDefault", { model: provider.defaultModel })}
          </option>
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          <option value={CUSTOM_MODEL}>{t("settings.ai.modelCustom")}</option>
        </select>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow
      label={t("settings.ai.model")}
      hint={t("settings.ai.modelHint", { model: provider.defaultModel })}
    >
      <input
        value={model}
        onChange={(event) => setModel(event.target.value)}
        placeholder={provider.defaultModel}
        spellCheck={false}
        className="h-8 w-56 min-w-0 rounded-md bg-bg px-2 font-mono text-xs text-fg ring-1 ring-elevated outline-none placeholder:text-muted focus:ring-subtle"
      />
      <RowButton
        onClick={() => {
          save(model);
          setTyping(false);
        }}
      >
        {t("settings.ai.save")}
      </RowButton>
      {hasList && (
        <RowButton onClick={() => setTyping(false)}>{t("settings.ai.modelFromList")}</RowButton>
      )}
    </SettingsRow>
  );
}

function TestConnectionRow({
  provider,
  run,
  busy,
  onModels,
}: {
  provider: ProviderView;
  run: Run;
  busy: boolean;
  onModels: (models: string[]) => void;
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[] | null>(null);
  const [testing, setTesting] = useState(false);

  const test = () => {
    if (busy || testing) return;
    setTesting(true);
    void run(() =>
      ipc.providerTest(provider.id).then((found) => {
        setModels(found);
        onModels(found);
        return found;
      }),
    ).finally(() => setTesting(false));
  };

  return (
    <SettingsRow
      label={t("settings.ai.connection")}
      hint={
        models === null
          ? t("settings.ai.connectionHint")
          : models.length === 1
            ? t("settings.ai.modelsOne", { count: models.length })
            : t("settings.ai.modelsMany", { count: models.length })
      }
    >
      <RowButton onClick={test} disabled={busy || testing}>
        {testing ? t("settings.ai.testing") : t("settings.ai.test")}
      </RowButton>
    </SettingsRow>
  );
}

function ModeSwitch({
  modes,
  value,
  onSelect,
  busy,
}: {
  modes: [CaptureTarget, string][];
  value: CaptureTarget;
  onSelect: (mode: CaptureTarget) => void;
  busy: boolean;
}) {
  return (
    <div className="flex gap-0.5 rounded-full bg-bg p-0.5">
      {modes.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          disabled={busy}
          onClick={() => onSelect(mode)}
          className={`rounded-full px-2.5 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40 ${
            value === mode ? "bg-elevated text-fg" : "text-muted hover:text-subtle"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
