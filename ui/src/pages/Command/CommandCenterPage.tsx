import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Mic, MicOff, Send } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useProjects } from "../../features/executionPlans";
import { interpretCommand, type CommandIntent } from "../../features/commandCenter/commandIntents";
import { useI18n, type MessageKey } from "../../i18n";
import "./CommandCenterPage.css";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * Mobile-first Command Center (UI Layer 7). A typed or spoken instruction is
 * interpreted deterministically into a structured READ / NAVIGATION request
 * and shown for confirmation. Nothing is executed from here; high-impact
 * actions are routed to the Approval Center. The microphone is only on while
 * the owner explicitly holds a listening session; no audio is stored.
 */
export default function CommandCenterPage() {
  const { t, language } = useI18n();
  const { projects } = useProjects();
  const [text, setText] = useState("");
  const [result, setResult] = useState<CommandIntent | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [fromVoice, setFromVoice] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const Recognition = speechRecognition();

  useEffect(() => () => recognition.current?.stop(), []);

  const interpret = (event?: FormEvent) => {
    event?.preventDefault();
    setResult(interpretCommand(text, projects));
  };

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    if (!Recognition) return;
    setVoiceError(null);
    const r = new Recognition();
    r.lang = language === "nl" ? "nl-NL" : "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
      // The transcript only fills the editable field. It is never interpreted
      // or acted on automatically.
      setText(transcript.slice(0, 300));
      setFromVoice(true);
      setResult(null);
    };
    r.onerror = (event) => setVoiceError(event.error);
    r.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    recognition.current = r;
    setListening(true);
    r.start();
  };

  const examples = (["a", "b", "c", "d", "e"] as const).map((k) => t(`mobileCommand.exampleList.${k}` as MessageKey));

  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={t("mobileCommand.title")} description={t("mobileCommand.description")} />

      <form className="cc-form" onSubmit={interpret}>
        <label htmlFor="cc-input" className="cc-label">{t("mobileCommand.inputLabel")}</label>
        <div className="cc-row">
          <input
            id="cc-input"
            className="cc-input"
            value={text}
            maxLength={300}
            autoComplete="off"
            placeholder={t("mobileCommand.placeholder")}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
          />
          {Recognition ? (
            <button
              type="button"
              className={`ui-button ghost cc-mic${listening ? " is-live" : ""}`}
              aria-pressed={listening}
              aria-label={listening ? t("mobileCommand.voiceStop") : t("mobileCommand.voiceStart")}
              title={listening ? t("mobileCommand.voiceStop") : t("mobileCommand.voiceStart")}
              onClick={toggleVoice}
            >
              {listening ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
            </button>
          ) : null}
          <button type="submit" className="ui-button primary cc-go" disabled={!text.trim()}>
            <Send size={16} aria-hidden /> {t("mobileCommand.interpret")}
          </button>
        </div>
        {listening ? <p className="cc-live" role="status">{t("mobileCommand.listening")}</p> : null}
        {!Recognition ? <p className="cc-muted">{t("mobileCommand.voiceUnsupported")}</p> : null}
        {voiceError ? <p role="alert">{t("mobileCommand.voiceError", { error: voiceError })}</p> : null}
        {fromVoice && text && !listening ? <p className="cc-muted">{t("mobileCommand.transcriptNote")}</p> : null}
      </form>

      {result ? (
        <section className="cc-result" aria-live="polite" aria-labelledby="cc-result-title">
          <h2 id="cc-result-title">{t("mobileCommand.result")}</h2>
          <IntentView intent={result} />
        </section>
      ) : null}

      <section className="cc-examples" aria-labelledby="cc-examples-title">
        <h2 id="cc-examples-title">{t("mobileCommand.examples")}</h2>
        <ul>
          {examples.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                className="cc-chip"
                onClick={() => {
                  setText(ex);
                  setFromVoice(false);
                  setResult(interpretCommand(ex, projects));
                }}
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}

function IntentView({ intent }: { intent: CommandIntent }) {
  const { t } = useI18n();
  switch (intent.kind) {
    case "open_project":
      return (
        <p>
          {t("mobileCommand.intents.open_project", { project: intent.label })} —{" "}
          <Link to={intent.to}>{t("mobileCommand.open")}</Link>
        </p>
      );
    case "navigate":
      return (
        <p>
          {t(`mobileCommand.intents.${intent.intent}` as MessageKey)} — <Link to={intent.to}>{t("mobileCommand.open")}</Link>
        </p>
      );
    case "requires_approval":
      return (
        <p className="cc-warn">
          {t("mobileCommand.intents.requires_approval", { action: intent.action })}{" "}
          <Link to={intent.to}>{t("mobileCommand.open")}</Link>
        </p>
      );
    case "search_knowledge":
      return (
        <p>
          {t("mobileCommand.intents.search_knowledge", { query: intent.query })} — <Link to={intent.to}>{t("mobileCommand.open")}</Link>
        </p>
      );
    case "unsupported_pull_requests":
      return <p className="cc-muted">{t("mobileCommand.intents.unsupported_pull_requests")}</p>;
    case "project_not_found":
      return <p className="cc-muted">{t("mobileCommand.projectNotFound", { query: intent.query })}</p>;
    default:
      return <p className="cc-muted">{t("mobileCommand.noMatch")}</p>;
  }
}
